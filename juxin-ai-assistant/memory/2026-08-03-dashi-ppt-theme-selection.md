# 2026-08-03 大师 PPT 风格选择解析修复

## 结论

大师 PPT 确认提示重复出现的原因是主题识别正则使用 `\\b`。Python 正则将中文视为单词字符，因此 `风格theme04不需要图片` 中的 `theme04` 两侧都没有形成边界，风格和素材选项都未完整解析。

## 修复

- 将主题匹配边界改为只排除 ASCII 字母、数字和下划线。
- 增加中文连续输入、无空格主题编号和“不需要图片”的回归测试。
- 不修改模型、运行时、版本号或生产配置。

## 验证

- `python3 -m pytest server/tests/test_chat_dashi_ppt.py -q`
- `python3 -m pytest server/tests/test_chat_api.py -q`
- `git diff --check`
