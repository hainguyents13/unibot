//! The gateways signed in to from this computer, newest first, as a JSON list in the app's config
//! folder. Addresses aren't secret: each one's sign-in is in Credential Manager. A file rather than
//! the webview's storage, so a development build and the installed app share it.

use std::fs;
use std::path::Path;

/// The saved list, or none when the file is missing or unreadable.
pub fn load(path: &Path) -> Vec<String> {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, gateways: &[String]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string(gateways).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("unibot-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("nested").join("recent-gateways.json")
    }

    #[test]
    fn saves_and_loads_the_list_in_order() {
        let path = scratch("round-trip");
        let list = vec![
            "http://100.101.102.103:9119".to_string(),
            "https://hermes.example.com".to_string(),
        ];
        save(&path, &list).unwrap();
        assert_eq!(load(&path), list);
        let _ = fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn a_missing_or_damaged_file_is_an_empty_list() {
        let path = scratch("damaged");
        assert!(load(&path).is_empty());
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "not json").unwrap();
        assert!(load(&path).is_empty());
        let _ = fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }
}
