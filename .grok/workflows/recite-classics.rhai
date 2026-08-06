let meta = #{
    name: "recite-classics",
    description: "派 3 个并行子 agent 分别背诵《出师表》《滕王阁序》《三字经》",
    when_to_use: "需要并行子 agent 背诵经典古文时",
    phases: [
        #{ title: "并行背诵三部经典", detail: "出师表 / 滕王阁序 / 三字经" }
    ]
};

let tasks = [
    #{
        prompt: "请完整背诵诸葛亮《出师表》全文，一字不差，逐句输出。不要解释，只输出正文。",
        label: "出师表",
        phase: "背诵《出师表》"
    },
    #{
        prompt: "请完整背诵王勃《滕王阁序》全文，一字不差，逐句输出。不要解释，只输出正文。",
        label: "滕王阁序",
        phase: "背诵《滕王阁序》"
    },
    #{
        prompt: "请完整背诵《三字经》全文，一字不差，逐句输出。不要解释，只输出正文。",
        label: "三字经",
        phase: "背诵《三字经》"
    }
];

// 并行派出 3 个子 agent，每个背诵一篇
let results = parallel(tasks);

// 汇总结果
let titles = ["出师表", "滕王阁序", "三字经"];
let summary = [];
for i in range(0, results.len) {
    let r = results[i];
    let status = if r.success { "背诵完成" } else { "背诵失败" };
    log(titles[i] + ": " + status + "（" + r.duration_ms + "ms）");
    summary.push(#{
        title: titles[i],
        success: r.success,
        output: r.output,
        tokens_used: r.tokens_used,
        duration_ms: r.duration_ms
    });
}

complete(#{
    status: "done",
    count: results.len,
    results: summary
});
