//! Saving a file a Bot made into the user's Downloads folder.

use std::fs::OpenOptions;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

/// A file name Windows accepts, from the gateway's name for it: no folders, none of `<>:"/\|?*`
/// or control characters, no trailing dots or spaces, and not a device name such as `CON`.
pub fn safe_name(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = last
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    let stem = cleaned
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.ends_with(|c: char| c.is_ascii_digit()));
    if cleaned.is_empty() || reserved {
        format!(
            "download{}",
            if cleaned.is_empty() {
                String::new()
            } else {
                format!("-{cleaned}")
            }
        )
    } else {
        cleaned
    }
}

/// Writes `bytes` into `folder` as `name`, or `name (1)`, `name (2)`… when that's taken, so
/// nothing already there is overwritten. Returns where it went.
pub fn save_new(folder: &Path, name: &str, bytes: &[u8]) -> std::io::Result<PathBuf> {
    let name = safe_name(name);
    let (stem, extension) = match name.rfind('.') {
        Some(dot) if dot > 0 => (&name[..dot], &name[dot..]),
        _ => (name.as_str(), ""),
    };
    for attempt in 0..1000 {
        let candidate = if attempt == 0 {
            folder.join(&name)
        } else {
            folder.join(format!("{stem} ({attempt}){extension}"))
        };
        // `create_new` checks and creates in one step, so two saves never take the same name.
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(mut file) => {
                file.write_all(bytes)?;
                return Ok(candidate);
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(
        ErrorKind::AlreadyExists,
        "too many files with this name",
    ))
}

/// `encodeURIComponent`'s output back to text; a malformed escape is kept as it came.
pub fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let hex = |b: u8| (b as char).to_digit(16);
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let (Some(high), Some(low)) = (hex(bytes[i + 1]), hex(bytes[i + 2]))
        {
            out.push((high * 16 + low) as u8);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_come_back_from_the_header() {
        assert_eq!(percent_decode("b%C3%A1o%20c%C3%A1o.pdf"), "báo cáo.pdf");
        assert_eq!(percent_decode("100%25.txt"), "100%.txt");
        assert_eq!(percent_decode("odd%2"), "odd%2");
        assert_eq!(percent_decode("odd%zz"), "odd%zz");
    }

    #[test]
    fn names_lose_folders_and_characters_windows_refuses() {
        assert_eq!(
            safe_name("/opt/data/x_unikornvn_19302.mp4"),
            "x_unikornvn_19302.mp4"
        );
        assert_eq!(safe_name("..\\..\\evil.exe"), "evil.exe");
        assert_eq!(safe_name("a<b>:c?.txt"), "a_b__c_.txt");
        assert_eq!(safe_name("notes. "), "notes");
        assert_eq!(safe_name("CON.txt"), "download-CON.txt");
        assert_eq!(safe_name("com1"), "download-com1");
        assert_eq!(safe_name("/opt/data/"), "download");
    }

    #[test]
    fn a_taken_name_gets_a_number_and_nothing_is_overwritten() {
        let folder = std::env::temp_dir().join(format!("unibot-downloads-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let first = save_new(&folder, "clip.mp4", b"one").unwrap();
        let second = save_new(&folder, "/remote/clip.mp4", b"two").unwrap();
        assert_eq!(first.file_name().unwrap(), "clip.mp4");
        assert_eq!(second.file_name().unwrap(), "clip (1).mp4");
        assert_eq!(std::fs::read(&first).unwrap(), b"one");
        assert_eq!(std::fs::read(&second).unwrap(), b"two");
        std::fs::remove_dir_all(&folder).unwrap();
    }
}
