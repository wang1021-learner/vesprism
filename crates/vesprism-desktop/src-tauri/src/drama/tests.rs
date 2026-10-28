use super::*;
use rusqlite::params;
use drama_core::model::{Node, NodeKind, PortType::*};

const PID: &str = "01JABCDEFGHJKMNPQRSTVWXYZ0";

fn fresh() -> (DramaState, PathBuf) {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let root = std::env::temp_dir().join(format!("drama-cmd-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(root.join(PID)).unwrap();
    let mut store = Store::open(&root.join(PID).join("project.sqlite")).unwrap();
    let n = |id: &str, kind, i: &[drama_core::model::PortType], o: &[drama_core::model::PortType]| Node {
        id: id.into(),
        kind,
        inputs: i.to_vec(),
        outputs: o.to_vec(),
        locked: false,
        needs_update: false,
        text: String::new(),
    };
    let mut g = Graph::default();
    g.add_node(n("voice", NodeKind::Voice, &[Line], &[Audio]));
    g.add_node(n("shot", NodeKind::Shot, &[Audio], &[Video]));
    g.add_node(n("export", NodeKind::Export, &[Video], &[FinalCut]));
    store.save_graph(&g).unwrap();
    (DramaState::new(root.clone()), root)
}

fn l(from: &str, to: &str, port: drama_core::model::PortType) -> Link {
    Link { from: from.into(), to: to.into(), port, source_item: None }
}

#[test]
fn unknown_or_path_project_is_not_found_and_creates_nothing() {
    let (st, root) = fresh();
    for bad in ["01JZZZZZZZZZZZZZZZZZZZZZZZ", "..\\..\\x", "../../etc", "C:\\Windows", "not-a-ulid"] {
        let e = load_graph(&st, bad).unwrap_err();
        assert_eq!(e.code, Code::NotFound, "{bad}");
    }
    assert!(!root.join("01JZZZZZZZZZZZZZZZZZZZZZZZ").exists(), "不建空库");
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
}

#[test]
fn link_errors_keep_separate_codes_and_success_returns_whole_graph() {
    let (st, _) = fresh();
    assert_eq!(link(&st, PID, l("shot", "voice", Video)).unwrap_err().code, Code::TypeMismatch);
    let v = link(&st, PID, l("voice", "shot", Audio)).unwrap();
    assert_eq!(v.nodes.len(), 3);
    assert_eq!(v.links.len(), 1);
    let v = link(&st, PID, l("shot", "export", Video)).unwrap();
    assert_eq!(v.links.len(), 2);
    let json = serde_json::to_value(&v).unwrap();
    assert!(json["nodes"][0].get("upstreamStale").is_some());
    let v = unlink(&st, PID, l("shot", "export", Video)).unwrap();
    assert_eq!(v.links.len(), 1);
}

#[test]
fn export_with_stale_requires_confirmation() {
    let (st, _) = fresh();
    link(&st, PID, l("voice", "shot", Audio)).unwrap(); // shot 标需更新
    let e = export(&st, PID, "export", false).unwrap_err();
    assert_eq!(e.code, Code::StaleNotConfirmed);
    let r = export(&st, PID, "export", true).unwrap();
    assert!(r.flagged.iter().any(|(id, k)| id == "shot" && k == "needs_update"));
    assert_eq!(serde_json::to_value(Code::StaleNotConfirmed).unwrap(), "stale_not_confirmed");
}

#[test]
fn state_survives_reopen_through_store() {
    let (st, root) = fresh();
    link(&st, PID, l("voice", "shot", Audio)).unwrap();
    drop(st);
    let st = DramaState::new(root);
    let v = load_graph(&st, PID).unwrap();
    assert!(v.nodes.iter().find(|n| n.node.id == "shot").unwrap().node.needs_update);
}

#[test]
fn create_then_list_projects_and_broken_ones_are_listed_separately() {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let root = std::env::temp_dir().join(format!("drama-proj-{}-{nanos}", std::process::id()));
    let st = DramaState::new(root.clone());
    assert_eq!(list_projects(&st).unwrap().projects.len(), 0, "根目录不存在时返回空列表");
    assert!(!root.exists(), "列表不建目录");
    let a = create_project(&st, Some("  第一集  ".into())).unwrap();
    assert!(is_ulid(&a.project_id));
    assert_eq!(a.name, "第一集");
    std::thread::sleep(std::time::Duration::from_millis(20));
    let b = create_project(&st, Some("   ".into())).unwrap();
    assert_eq!(b.name, projects::DEFAULT_NAME);
    assert_ne!(a.project_id, b.project_id);
    assert!(load_graph(&st, &a.project_id).unwrap().nodes.is_empty());
    let bad = projects::new_ulid();
    std::fs::create_dir_all(root.join(&bad)).unwrap();
    std::fs::write(root.join(&bad).join("project.sqlite"), b"garbage garbage garbage garbage!!").unwrap();
    let missing = projects::new_ulid();
    std::fs::create_dir_all(root.join(&missing)).unwrap();
    std::fs::create_dir_all(root.join("not-ours")).unwrap();
    let l = list_projects(&DramaState::new(root.clone())).unwrap();
    let ids: Vec<_> = l.projects.iter().map(|p| p.project_id.as_str()).collect();
    assert_eq!(ids, [b.project_id.as_str(), a.project_id.as_str()], "按更新时间倒序");
    assert_eq!(l.projects[1].name, "第一集", "重启后名字从库里读回");
    let broken: Vec<_> = l.broken.iter().map(|p| p.project_id.clone()).collect();
    assert_eq!(broken.len(), 2);
    assert!(broken.contains(&bad) && broken.contains(&missing));
    let json = serde_json::to_value(&l).unwrap();
    assert!(json["projects"][0].get("updatedAt").is_some());
    assert!(json["broken"][0].get("message").is_some());
}

#[test]
fn ulid_is_monotonic_enough_and_valid() {
    let ids: std::collections::HashSet<_> = (0..2000).map(|_| projects::new_ulid()).collect();
    assert_eq!(ids.len(), 2000);
    assert!(ids.iter().all(|i| is_ulid(i)));
}

#[test]
fn fake_job_pushes_every_step_until_done_and_clears_mark() {
    let (st, _) = fresh();
    link(&st, PID, l("voice", "shot", Audio)).unwrap(); // shot 需更新
    let first = jobs::start_job(&st, PID, "shot").unwrap();
    assert_eq!(first.status, drama_core::event::JobStatus::Queued);
    assert_eq!(jobs::start_job(&st, PID, "nope").unwrap_err().code, Code::NotFound);
    let seen = std::cell::RefCell::new(Vec::new());
    let last = jobs::run(&st, PID, &first.job_id, |_| {}, |ev| seen.borrow_mut().push(ev.clone())).unwrap();
    let seen = seen.into_inner();
    use drama_core::event::JobStatus::*;
    assert_eq!(last.status, Done);
    assert!(seen.iter().all(|e| e.job_id == first.job_id && e.node_id == "shot"));
    assert!(seen.iter().filter(|e| e.status == Running).count() >= 2, "能看到进度变化");
    let ps: Vec<f32> = seen.iter().map(|e| e.progress).collect();
    assert!(ps.windows(2).all(|w| w[0] <= w[1]), "进度不倒退: {ps:?}");
    assert_eq!(seen.last().unwrap().progress, 1.0);
    let v = load_graph(&st, PID).unwrap();
    assert!(!v.nodes.iter().find(|n| n.node.id == "shot").unwrap().node.needs_update);
    let json = serde_json::to_value(&last).unwrap();
    assert_eq!(json["status"], "done");
    assert!(json.get("jobId").is_some());
}

#[test]
fn failed_fake_job_retries_with_same_id_and_list_shows_current_state() {
    use drama_core::event::{JobErrorCode, JobStatus::*};
    let (mut st, _) = fresh();
    st.fake = jobs::fake_provider_with(Some("submit_timeout"));
    let job = jobs::start_job(&st, PID, "shot").unwrap().job_id;
    let failed = jobs::run(&st, PID, &job, |_| {}, |_| {}).unwrap();
    assert_eq!(failed.status, Failed);
    assert_eq!(failed.error_code, Some(JobErrorCode::UnconfirmedSubmit));
    let listed = jobs::list_jobs(&st, PID).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!((listed[0].job_id.as_str(), listed[0].status), (job.as_str(), Failed));
    retry_confirmed(&st, PID, &job).unwrap();
    assert_eq!(jobs::list_jobs(&st, PID).unwrap()[0].status, Queued, "重试后回到排队");
    let done = jobs::run(&st, PID, &job, |_| {}, |_| {}).unwrap();
    assert_eq!((done.job_id.as_str(), done.status), (job.as_str(), Done), "沿用原编号");
    assert_eq!(jobs::list_jobs(&st, PID).unwrap()[0].status, Done);
}

#[test]
fn layout_saved_then_read_back_after_reopen_and_marks_unchanged() {
    let (st, root) = fresh();
    link(&st, PID, l("voice", "shot", Audio)).unwrap(); // shot 需更新
    let job = jobs::start_job(&st, PID, "shot").unwrap().job_id;
    let before = load_graph(&st, PID).unwrap();
    let jobs_before = jobs::list_jobs(&st, PID).unwrap();
    set_layout(&st, PID, "shot", 120.5, -40.0, true).unwrap();
    set_layout(&st, PID, "voice", 3.0, 4.0, false).unwrap();
    set_layout(&st, PID, "shot", 121.0, -41.0, true).unwrap();
    assert_eq!(set_layout(&st, PID, "nope", 0.0, 0.0, false).unwrap_err().code, Code::NotFound);
    drop(st);
    let st = DramaState::new(root);
    let v = load_graph(&st, PID).unwrap();
    use drama_core::model::NodeLayout;
    assert_eq!(v.layout["shot"], NodeLayout { x: 121.0, y: -41.0, collapsed: true });
    assert_eq!(v.layout["voice"], NodeLayout { x: 3.0, y: 4.0, collapsed: false });
    assert!(!v.layout.contains_key("export"));
    assert_eq!(v.nodes, before.nodes, "需更新标记不变");
    assert_eq!(v.links, before.links);
    assert_eq!(jobs::list_jobs(&st, PID).unwrap(), jobs_before, "任务状态不变");
    assert_eq!(jobs_before[0].job_id, job);
    let json = serde_json::to_value(&v).unwrap();
    assert_eq!(json["layout"]["shot"]["collapsed"], true);
}

#[test]
fn added_node_survives_reopen_and_can_link() {
    let (st, root) = fresh();
    let r = add_node(&st, PID, NodeKind::Voice, Position { x: 10.0, y: 20.0 }).unwrap();
    let v = r.graph.clone();
    let before: Vec<_> = ["voice", "shot", "export"].into();
    let found = v.nodes.iter().map(|n| n.node.id.clone()).find(|id| !before.contains(&id.as_str())).unwrap();
    let nid = r.node_id.clone();
    assert_eq!(nid, found, "返回的 nodeId 就是新节点");
    assert_eq!(nid.len(), 26);
    assert_eq!(v.layout[&nid].x, 10.0);
    let json = serde_json::to_value(&r).unwrap();
    assert_eq!(json["nodeId"], nid.as_str());
    assert!(json["graph"]["nodes"].is_array());
    assert!(v.nodes.iter().all(|n| matches!(n.asset, Some(None)) || matches!(n.image, Some(None))), "还没生成：null");
    drop(st);
    let st = DramaState::new(root);
    let v = load_graph(&st, PID).unwrap();
    let n = v.nodes.iter().find(|n| n.node.id == nid).expect("重开还在");
    assert_eq!(n.node.kind, NodeKind::Voice);
    assert_eq!(v.layout[&nid].y, 20.0);
    let v = link(&st, PID, l(&nid, "shot", Audio)).unwrap();
    assert!(v.links.iter().any(|x| x.from == nid));
    assert_eq!(add_node(&st, "nope", NodeKind::Shot, Position { x: 0.0, y: 0.0 }).unwrap_err().code, Code::NotFound);
}

#[test]
fn removing_node_drops_its_links_and_locked_is_refused() {
    let (st, root) = fresh();
    link(&st, PID, l("voice", "shot", Audio)).unwrap();
    link(&st, PID, l("shot", "export", Video)).unwrap();
    set_layout(&st, PID, "shot", 1.0, 2.0, false).unwrap();
    let v = remove_node(&st, PID, "shot").unwrap();
    assert!(v.nodes.iter().all(|n| n.node.id != "shot"));
    assert!(v.links.is_empty(), "连着它的线一起删");
    assert!(!v.layout.contains_key("shot"));
    assert_eq!(remove_node(&st, PID, "shot").unwrap_err().code, Code::NotFound);
    drop(st);
    // 定稿的剧本
    {
        let mut s = Store::open(&root.join(PID).join("project.sqlite")).unwrap();
        let mut g = s.load_graph().unwrap();
        let (i, o) = NodeKind::Script.default_ports();
        g.add_node(Node { id: "script".into(), kind: NodeKind::Script, inputs: i, outputs: o, locked: true, needs_update: false, text: String::new() });
        s.save_graph(&g).unwrap();
    }
    let st = DramaState::new(root);
    let v = load_graph(&st, PID).unwrap();
    assert!(v.links.is_empty() && v.nodes.iter().all(|n| n.node.id != "shot"), "重开后删除还在");
    assert_eq!(remove_node(&st, PID, "script").unwrap_err().code, Code::ScriptLocked);
    assert!(load_graph(&st, PID).unwrap().nodes.iter().any(|n| n.node.id == "script"));
}

// ---- 第三轮：素材 ----

fn path_of(a: &Option<Option<drama_core::asset::AssetRef>>) -> Option<String> {
    a.clone().flatten().map(|r| r.path)
}

fn node_view<'a>(v: &'a GraphView, id: &str) -> &'a drama_core::model::NodeView {
    v.nodes.iter().find(|n| n.node.id == id).unwrap()
}

#[test]
fn shot_and_voice_jobs_store_png_and_wav_and_export_completes() {
    let (st, root) = fresh();
    link(&st, PID, l("voice", "shot", Audio)).unwrap();
    link(&st, PID, l("shot", "export", Video)).unwrap();
    for n in ["voice", "shot"] {
        let j = jobs::start_job(&st, PID, n).unwrap().job_id;
        assert_eq!(jobs::run(&st, PID, &j, |_| {}, |_| {}).unwrap().status, drama_core::event::JobStatus::Done);
    }
    let v = load_graph(&st, PID).unwrap();
    let shot = node_view(&v, "shot");
    assert!(shot.asset.is_none(), "镜头不带 asset 字段");
    let img = shot.image.clone().flatten().expect("镜头有图");
    assert!(shot.video.clone().flatten().is_none());
    assert_eq!((img.mime.as_str(), img.width, img.height), ("image/png", Some(320), Some(180)));
    let p = std::path::Path::new(&img.path);
    assert!(p.is_absolute());
    let canon_assets = std::fs::canonicalize(root.join(PID).join("assets")).unwrap();
    assert!(std::fs::canonicalize(p).unwrap().starts_with(&canon_assets));
    let bytes = std::fs::read(p).unwrap();
    let mut r = png::Decoder::new(std::io::Cursor::new(&bytes)).read_info().unwrap();
    let mut buf = vec![0; r.output_buffer_size()];
    assert_eq!(r.next_frame(&mut buf).unwrap().width, 320, "PNG 能解码");
    let voice = node_view(&v, "voice");
    assert!(voice.image.is_none() && voice.video.is_none());
    let wav = voice.asset.clone().flatten().expect("配音有音频");
    assert_eq!(wav.mime, "audio/wav");
    let est = drama_core::fake_media::estimate_speech_ms(jobs::PLACEHOLDER_LINE);
    let got = drama_core::fake_media::wav_duration_ms(&std::fs::read(&wav.path).unwrap()).unwrap();
    assert!((got as f64 - est as f64).abs() <= est as f64 * 0.10, "est {est} got {got}");
    assert_eq!(wav.duration_ms, Some(est));
    // 文件名就是内容 hash
    let name = p.file_name().unwrap().to_string_lossy().into_owned();
    assert!(name.len() == 68 && name.ends_with(".png") && name[..64].bytes().all(|b| b.is_ascii_hexdigit()));
    // 导出：导出节点因新连线带角标，确认后导出完成；带上镜头的图
    let r = export(&st, PID, "export", true).unwrap();
    assert!(r.flagged.iter().all(|(id, _)| id == "export"));
    assert_eq!(r.inputs.len(), 1);
    assert_eq!(r.inputs[0].path, img.path);
    let j = serde_json::to_value(&v).unwrap();
    let sj = j["nodes"].as_array().unwrap().iter().find(|n| n["id"] == "shot").unwrap();
    assert!(sj.get("image").is_some() && sj.get("video").is_some() && sj.get("asset").is_none());
    assert!(sj["video"].is_null());
    assert!(sj["image"].get("durationMs").is_none(), "没有的可选字段不出现");
}

#[test]
fn failed_latest_generation_keeps_previous_success() {
    use drama_core::event::JobStatus::*;
    let (mut st, _) = fresh();
    let j1 = jobs::start_job(&st, PID, "shot").unwrap().job_id;
    jobs::run(&st, PID, &j1, |_| {}, |_| {}).unwrap();
    let first = path_of(&node_view(&load_graph(&st, PID).unwrap(), "shot").image).expect("第一次成功");
    // 新任务失败
    st.fake = jobs::fake_provider_with(Some("task_failed"));
    let j2 = jobs::start_job(&st, PID, "shot").unwrap().job_id;
    assert_eq!(jobs::run(&st, PID, &j2, |_| {}, |_| {}).unwrap().status, Failed);
    assert_eq!(path_of(&node_view(&load_graph(&st, PID).unwrap(), "shot").image).as_deref(), Some(first.as_str()));
    // 同一个任务确认重试、又失败：归档的那次成功还在
    st.fake = jobs::fake_provider_with(Some("task_failed"));
    retry_confirmed(&st, PID, &j1).unwrap();
    assert_eq!(jobs::run(&st, PID, &j1, |_| {}, |_| {}).unwrap().status, Failed);
    assert_eq!(path_of(&node_view(&load_graph(&st, PID).unwrap(), "shot").image).as_deref(), Some(first.as_str()));
}

#[test]
fn moved_project_dir_still_loads_assets_and_bad_paths_are_not_found() {
    let (st, root) = fresh();
    let j = jobs::start_job(&st, PID, "voice").unwrap().job_id;
    jobs::run(&st, PID, &j, |_| {}, |_| {}).unwrap();
    drop(st);
    let root2 = root.with_file_name(format!("{}-moved", root.file_name().unwrap().to_string_lossy()));
    std::fs::rename(&root, &root2).unwrap();
    let st = DramaState::new(root2.clone());
    let v = load_graph(&st, PID).unwrap();
    let p = path_of(&node_view(&v, "voice").asset).expect("搬家后还在");
    assert!(std::fs::canonicalize(&p).unwrap().starts_with(std::fs::canonicalize(&root2).unwrap()));
    for bad in ["../project.sqlite", "assets/../project.sqlite", "project.sqlite", "/etc/passwd", "C:\\Windows\\win.ini", "assets/../../x"] {
        assert_eq!(asset_path(&st, PID, bad).unwrap_err().code, Code::NotFound, "{bad}");
    }
    let rel = format!("assets/{}", std::path::Path::new(&p).file_name().unwrap().to_string_lossy());
    assert!(asset_path(&st, PID, &rel).is_ok());
    // 库里被改成跑出去的路径：图里当作没有，不暴露
    {
        let s = Store::open(&root2.join(PID).join("project.sqlite")).unwrap();
        s.conn().execute("UPDATE asset SET rel_path = '../project.sqlite'", []).unwrap();
    }
    let st = DramaState::new(root2);
    assert!(path_of(&node_view(&load_graph(&st, PID).unwrap(), "voice").asset).is_none());
}

/// 素材读取配置只在漫剧开关里：合并内容放行 assets/ 和 media-src，默认配置不动。
#[test]
fn drama_conf_is_merged_only_with_feature_and_scoped_to_assets() {
    let merged = env!("TAURI_CONFIG");
    let v: serde_json::Value = serde_json::from_str(merged).unwrap();
    let sec = &v["app"]["security"];
    assert_eq!(sec["assetProtocol"]["enable"], true);
    let scope: Vec<&str> = sec["assetProtocol"]["scope"].as_array().unwrap().iter().map(|s| s.as_str().unwrap()).collect();
    assert!(scope.contains(&"$HOME/.vesprism/drama/*/assets/**"));
    assert!(scope.iter().all(|s| s.ends_with("/assets/**") || *s == "$TEMP/vesprism-paste/**"), "不放行 assets/ 以外：{scope:?}");
    assert_eq!(sec["csp"]["media-src"], "'self' asset: http://asset.localhost");
    let default_conf = include_str!("../../tauri.conf.json");
    assert!(!default_conf.contains("media-src") && !default_conf.contains("drama"), "默认配置不含漫剧的放行");
}

/// 角色拖线到配音：旧项目里配音节点存的是老端口，重开后也能连，返回的图里端口是新表。
#[test]
fn character_can_link_into_voice() {
    let (st, root) = fresh(); // fresh 里 voice 存的是老端口 [line]
    drop(st);
    {
        let mut s = Store::open(&root.join(PID).join("project.sqlite")).unwrap();
        let mut g = s.load_graph().unwrap();
        let (i, o) = NodeKind::Character.default_ports();
        g.add_node(Node { id: "char".into(), kind: NodeKind::Character, inputs: i, outputs: o, locked: false, needs_update: false, text: String::new() });
        s.save_graph(&g).unwrap();
    }
    let st = DramaState::new(root);
    let v = load_graph(&st, PID).unwrap();
    assert!(node_view(&v, "voice").node.inputs.contains(&CharacterLook), "前端拿到的配音端口含角色形象");
    let v = link(&st, PID, l("char", "voice", CharacterLook)).unwrap();
    assert!(v.links.iter().any(|x| x.from == "char" && x.to == "voice" && x.port == CharacterLook));
    let r = add_node(&st, PID, NodeKind::Voice, Position { x: 0.0, y: 0.0 }).unwrap();
    assert!(link(&st, PID, l("char", &r.node_id, CharacterLook)).is_ok(), "新建的配音也能连");
}

// ---- 非法连线（旧项目遗留）----

/// 手工拼一个旧库：有 shot_group -> shot (image) 这种现在不合法的线，另有合法线；
/// 导出节点上挂着需更新的镜头，用来验证检查顺序。
fn stale_project() -> (DramaState, PathBuf) {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    let root = std::env::temp_dir().join(format!("drama-bad-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(root.join(PID)).unwrap();
    {
        let mut store = Store::open(&root.join(PID).join("project.sqlite")).unwrap();
        let mut g = Graph::default();
        for (id, kind) in [
            ("script", NodeKind::Script),
            ("sg", NodeKind::ShotGroup),
            ("shot", NodeKind::Shot),
            ("export", NodeKind::Export),
        ] {
            let (inputs, outputs) = kind.default_ports();
            g.add_node(Node { id: id.into(), kind, inputs, outputs, locked: false, needs_update: id == "shot", text: String::new() });
        }
        store.save_graph(&g).unwrap();
        for (f, t, port) in [("script", "shot", "line"), ("shot", "export", "video"), ("sg", "shot", "image")] {
            store
                .conn()
                .execute("INSERT INTO links (from_id, to_id, port, source_item) VALUES (?1, ?2, ?3, '')", params![f, t, format!("\"{port}\"")])
                .unwrap();
        }
    }
    (DramaState::new(root.clone()), root)
}

fn db_bytes(root: &std::path::Path) -> Vec<u8> {
    std::fs::read(root.join(PID).join("project.sqlite")).unwrap()
}

fn bad_link() -> Link {
    l("sg", "shot", Image)
}

#[test]
fn stale_illegal_link_opens_flags_invalid_and_opening_changes_zero_bytes() {
    let (st, root) = stale_project();
    drop(st);
    let before = db_bytes(&root);
    let st = DramaState::new(root.clone());
    let v = load_graph(&st, PID).unwrap();
    assert_eq!(v.links.len(), 3, "项目照常打开，三条线都在");
    let flags: Vec<(String, bool)> = v.links.iter().map(|x| (x.from.clone(), x.invalid)).collect();
    assert!(flags.contains(&("sg".to_string(), true)));
    assert!(flags.contains(&("script".to_string(), false)) && flags.contains(&("shot".to_string(), false)));
    let json = serde_json::to_value(&v).unwrap();
    assert!(json["links"].as_array().unwrap().iter().all(|x| x["invalid"].is_boolean()), "每条线都带 invalid");
    let bad = json["links"].as_array().unwrap().iter().find(|x| x["from"] == "sg").unwrap();
    assert_eq!((bad["port"].as_str(), bad["invalid"].as_bool()), (Some("image"), Some(true)));
    assert!(list_projects(&st).unwrap().broken.is_empty());
    drop(st);
    assert_eq!(db_bytes(&root), before, "打开、读图、列项目都不写库：零字节变化");
}

#[test]
fn unlink_invalid_works_link_cannot_recreate_and_downstream_not_marked() {
    let (st, _) = stale_project();
    // 非法线不是生成输入、不进提示词
    with_project(&st, PID, |p| {
        p.graph.set_text("sg", "分镜正文".into()).unwrap();
        p.graph.set_text("script", "雨夜".into()).unwrap();
        p.graph.clear_needs_update("shot");
        p.graph.clear_needs_update("script");
        p.graph.clear_needs_update("sg");
        let ins: Vec<_> = p.graph.generation_inputs("shot").iter().map(|x| x.from.clone()).collect();
        assert_eq!(ins, ["script"]);
        assert_eq!(p.graph.prompt_text("shot"), "剧本：雨夜");
        Ok(())
    })
    .unwrap();
    let v = unlink(&st, PID, bad_link()).unwrap();
    assert_eq!(v.links.len(), 2);
    assert!(v.links.iter().all(|x| !x.invalid));
    assert!(!node_view(&v, "shot").node.needs_update, "删非法线不让下游变需更新");
    assert_eq!(link(&st, PID, bad_link()).unwrap_err().code, Code::TypeMismatch, "不能再连出来");
    assert_eq!(load_graph(&st, PID).unwrap().links.len(), 2);
    // 删非法线是落库的
    let st2 = DramaState::new(st.root().to_path_buf());
    assert_eq!(load_graph(&st2, PID).unwrap().links.len(), 2);
}

#[test]
fn export_is_blocked_by_invalid_link_even_when_stale_confirmed_and_records_nothing() {
    let (st, _) = stale_project();
    let snapshots = |st: &DramaState| -> i64 {
        with_project(st, PID, |p| Ok(p.store.conn().query_row("SELECT count(*) FROM export_snapshots", [], |r| r.get(0)).unwrap())).unwrap()
    };
    for confirmed in [false, true] {
        let e = export(&st, PID, "export", confirmed).unwrap_err();
        assert_eq!(e.code, Code::InvalidLink, "staleConfirmed={confirmed}");
        assert_eq!(e.links, [bad_link()], "带上非法连线");
        let j = serde_json::to_value(&e).unwrap();
        assert_eq!(j["code"], "invalid_link");
        assert_eq!(j["links"][0]["from"], "sg");
        assert_eq!(j["links"][0]["to"], "shot");
        assert_eq!(j["links"][0]["port"], "image");
        assert_eq!(snapshots(&st), 0, "没记快照");
    }
    // 别的错误不带 links 字段
    let j = serde_json::to_value(export(&st, PID, "nope", true).unwrap_err()).unwrap();
    assert_eq!(j["code"], "not_found");
    assert!(j.get("links").is_none());
    // 删掉非法线后：镜头仍是需更新，要确认；确认后才能导出
    unlink(&st, PID, bad_link()).unwrap();
    assert_eq!(export(&st, PID, "export", false).unwrap_err().code, Code::StaleNotConfirmed);
    assert!(export(&st, PID, "export", true).is_ok());
    assert_eq!(snapshots(&st), 1);
}
