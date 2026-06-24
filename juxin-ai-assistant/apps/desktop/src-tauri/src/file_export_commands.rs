use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, WebviewWindow};

#[tauri::command]
pub fn generation_word_save(
    app: AppHandle,
    window: WebviewWindow,
    windows: tauri::State<'_, crate::window_manager::WindowManagerState>,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    crate::window_manager::guard_business(&window, &windows)?;
    if bytes.is_empty() {
        return Err("WORD_EXPORT_EMPTY".to_string());
    }
    let download_dir = app
        .path()
        .download_dir()
        .map_err(|_| "无法读取系统下载目录".to_string())?;
    fs::create_dir_all(&download_dir).map_err(|_| "无法创建系统下载目录".to_string())?;
    let path = next_available_path(&download_dir, &safe_docx_file_name(&file_name));
    fs::write(&path, bytes).map_err(|_| "无法保存 Word 文件".to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

fn safe_docx_file_name(file_name: &str) -> String {
    let without_path = file_name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(file_name)
        .trim();
    let cleaned: String = without_path
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .take(120)
        .collect();
    let stem = cleaned.trim_matches([' ', '.']).trim();
    let stem = if stem.is_empty() {
        "聚信得仁文档"
    } else {
        stem
    };
    if stem.to_lowercase().ends_with(".docx") {
        stem.to_string()
    } else {
        format!("{stem}.docx")
    }
}

fn next_available_path(directory: &Path, file_name: &str) -> PathBuf {
    let first = directory.join(file_name);
    if !first.exists() {
        return first;
    }
    let stem = file_name
        .strip_suffix(".docx")
        .or_else(|| file_name.strip_suffix(".DOCX"))
        .unwrap_or(file_name);
    (1..)
        .map(|index| directory.join(format!("{stem} ({index}).docx")))
        .find(|path| !path.exists())
        .unwrap_or(first)
}

#[cfg(test)]
mod tests {
    use super::{next_available_path, safe_docx_file_name};

    #[test]
    fn keeps_export_file_name_docx_safe() {
        assert_eq!(
            safe_docx_file_name(r#"../周报:总结/\坏";x=y"#),
            "坏_;x=y.docx"
        );
        assert_eq!(safe_docx_file_name("report.docx"), "report.docx");
        assert_eq!(safe_docx_file_name("   "), "聚信得仁文档.docx");
    }

    #[test]
    fn avoids_overwriting_existing_exports() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("work.docx"), b"old").unwrap();

        assert_eq!(
            next_available_path(dir.path(), "work.docx"),
            dir.path().join("work (1).docx")
        );
    }
}
