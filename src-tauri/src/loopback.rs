//! A one-shot HTTP listener on `127.0.0.1` that catches the browser redirect finishing sign-in
//! (`GET /callback?code=…&state=…`), answers with a short "you can close this" page, and hands
//! the query to the waiting caller. The gateway only accepts loopback IP redirects (RFC 8252 §7.3).

use std::sync::Mutex;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

pub const CALLBACK_PATH: &str = "/callback";

/// Errors the frontend tells apart by their text.
pub const TIMED_OUT: &str = "timedOut";
pub const CANCELLED: &str = "cancelled";

#[derive(Default)]
pub struct Loopback {
    pending: Mutex<Option<Pending>>,
}

struct Pending {
    callback: oneshot::Receiver<String>,
    task: tauri::async_runtime::JoinHandle<()>,
}

impl Loopback {
    /// Starts listening on an ephemeral loopback port, replacing any listener still waiting.
    pub async fn start(&self) -> Result<u16, String> {
        self.cancel();
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|e| format!("couldn't listen for the sign-in redirect: {e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let (sender, callback) = oneshot::channel();
        let task = tauri::async_runtime::spawn(accept_until_callback(listener, sender));
        *self.pending.lock().unwrap() = Some(Pending { callback, task });
        Ok(port)
    }

    /// Waits for the redirect's query string. Fails with `timedOut` or `cancelled`.
    pub async fn wait(&self, timeout: Duration) -> Result<String, String> {
        let callback = match self.pending.lock().unwrap().as_mut() {
            Some(pending) => std::mem::replace(&mut pending.callback, oneshot::channel().1),
            None => return Err(CANCELLED.into()),
        };
        let outcome = match tokio::time::timeout(timeout, callback).await {
            Ok(Ok(query)) => Ok(query),
            Ok(Err(_)) => Err(CANCELLED.into()),
            Err(_) => Err(TIMED_OUT.into()),
        };
        self.cancel();
        outcome
    }

    /// Stops listening. A waiting `wait` fails with `cancelled`.
    pub fn cancel(&self) {
        if let Some(pending) = self.pending.lock().unwrap().take() {
            pending.task.abort();
        }
    }
}

async fn accept_until_callback(listener: TcpListener, sender: oneshot::Sender<String>) {
    while let Ok((stream, _)) = listener.accept().await {
        if let Some(query) = serve(stream).await {
            let _ = sender.send(query);
            return;
        }
    }
}

/// Answers one connection. Returns the query when it was the sign-in callback.
async fn serve(mut stream: TcpStream) -> Option<String> {
    let mut buffer = vec![0u8; 16 * 1024];
    let mut read = 0;
    while read < buffer.len() {
        match stream.read(&mut buffer[read..]).await {
            Ok(0) | Err(_) => break,
            Ok(n) => read += n,
        }
        if buffer[..read].windows(2).any(|w| w == b"\r\n") {
            break;
        }
    }
    let query = request_target(&buffer[..read])
        .and_then(|target| callback_query(&target).map(str::to_owned));
    let response = match query {
        Some(_) => response("200 OK", SUCCESS_PAGE),
        None => response("404 Not Found", ""),
    };
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
    query
}

/// The target of an HTTP/1.x GET request line, e.g. `/callback?code=x` from
/// `GET /callback?code=x HTTP/1.1`.
fn request_target(request: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(request).ok()?;
    let line = text.split("\r\n").next()?;
    let mut parts = line.split(' ');
    let (method, target, version) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some()
        || method != "GET"
        || !target.starts_with('/')
        || !version.starts_with("HTTP/")
    {
        return None;
    }
    Some(target.to_owned())
}

/// The query of a request to the callback path (empty when it has none).
fn callback_query(target: &str) -> Option<&str> {
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    (path == CALLBACK_PATH).then_some(query)
}

fn response(status: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\
         Cache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

const SUCCESS_PAGE: &str = r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Signed in to Unibot</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f5f4;color:#1c1917;
font:16px "Segoe UI",system-ui,sans-serif}@media(prefers-color-scheme:dark){body{background:#1c1b1a;
color:#f5f5f4}}</style></head><body><main><h1 style="font-size:20px;font-weight:600">You're signed in</h1>
<p>You can close this tab and go back to Unibot.</p></main></body></html>"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_target_of_a_get_request() {
        let request = b"GET /callback?code=abc&state=xyz HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        assert_eq!(
            request_target(request).as_deref(),
            Some("/callback?code=abc&state=xyz")
        );
    }

    #[test]
    fn ignores_anything_but_a_plain_get() {
        assert_eq!(request_target(b"POST /callback HTTP/1.1\r\n\r\n"), None);
        assert_eq!(
            request_target(b"GET http://evil/callback HTTP/1.1\r\n\r\n"),
            None
        );
        assert_eq!(request_target(b"not http"), None);
    }

    #[test]
    fn only_the_callback_path_counts() {
        assert_eq!(callback_query("/callback?code=1"), Some("code=1"));
        assert_eq!(callback_query("/callback"), Some(""));
        assert_eq!(callback_query("/favicon.ico"), None);
        assert_eq!(callback_query("/callbackx?code=1"), None);
    }

    #[tokio::test]
    async fn hands_over_the_callback_query_and_answers_the_browser() {
        let loopback = Loopback::default();
        let port = loopback.start().await.unwrap();

        let browser = tokio::spawn(async move {
            // A stray request first, as browsers ask for a favicon.
            let mut favicon = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            favicon
                .write_all(b"GET /favicon.ico HTTP/1.1\r\n\r\n")
                .await
                .unwrap();
            let mut answer = String::new();
            favicon.read_to_string(&mut answer).await.unwrap();
            assert!(answer.starts_with("HTTP/1.1 404"));

            let mut redirect = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            redirect
                .write_all(b"GET /callback?code=c&state=s HTTP/1.1\r\n\r\n")
                .await
                .unwrap();
            let mut answer = String::new();
            redirect.read_to_string(&mut answer).await.unwrap();
            answer
        });

        let query = loopback.wait(Duration::from_secs(5)).await.unwrap();
        assert_eq!(query, "code=c&state=s");
        assert!(browser.await.unwrap().contains("You're signed in"));
    }

    #[tokio::test]
    async fn times_out_when_the_browser_never_comes_back() {
        let loopback = Loopback::default();
        loopback.start().await.unwrap();
        let outcome = loopback.wait(Duration::from_millis(50)).await;
        assert_eq!(outcome, Err(TIMED_OUT.to_string()));
    }

    #[tokio::test]
    async fn waiting_without_a_listener_is_cancelled() {
        let loopback = Loopback::default();
        assert_eq!(
            loopback.wait(Duration::from_secs(1)).await,
            Err(CANCELLED.to_string())
        );
    }
}
