from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.learning_eval import DEFAULT_EVAL_PATH, run_learning_eval


def main() -> int:
    parser = argparse.ArgumentParser(description="运行聚信 AI 助手学习闭环离线评测。")
    parser.add_argument("--questions", type=Path, default=DEFAULT_EVAL_PATH)
    parser.add_argument("--json", action="store_true", help="输出 JSON 报告")
    args = parser.parse_args()

    report = run_learning_eval(args.questions)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"learning eval: {report['passed']}/{report['total']} passed")
        for item in report["results"]:
            status = "PASS" if item["passed"] else "FAIL"
            print(f"- {status} {item['id']} mode={item['mode']} task={item['task_type']}")
            if item["missing"]:
                print(f"  missing: {', '.join(item['missing'])}")
    return 0 if report["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
