fn main() {
    // 漫剧开关打开时，把 tauri.drama.conf.json 合并进配置（JSON merge patch：
    // 只加 media-src、放行项目 assets/ 目录）。默认构建不读这个文件，配置不变。
    println!("cargo:rerun-if-changed=tauri.drama.conf.json");
    if std::env::var_os("CARGO_FEATURE_DRAMA").is_some() {
        let conf = std::fs::read_to_string("tauri.drama.conf.json").expect("读取 tauri.drama.conf.json");
        // 压成一行（字符串值里没有换行），环境变量才放得下。
        let one_line: String = conf.lines().map(str::trim).collect();
        // tauri-build 在本进程里读；generate_context! 宏在编译本 crate 时读。
        // SAFETY: build 脚本单线程，此时没有其他线程读环境变量。
        unsafe { std::env::set_var("TAURI_CONFIG", &one_line) };
        println!("cargo:rustc-env=TAURI_CONFIG={one_line}");
    }
    tauri_build::build()
}
