//! Keeps one gateway's sign-in in Windows Credential Manager, as a generic credential named after
//! the gateway. The frontend decides what goes in it; this only stores and returns the text.

const SERVICE: &str = "Unibot gateway sign-in";

fn entry(gateway: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, gateway).map_err(|e| e.to_string())
}

pub fn load(gateway: &str) -> Result<Option<String>, String> {
    match entry(gateway)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save(gateway: &str, secret: &str) -> Result<(), String> {
    entry(gateway)?
        .set_password(secret)
        .map_err(|e| e.to_string())
}

pub fn delete(gateway: &str) -> Result<(), String> {
    match entry(gateway)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
