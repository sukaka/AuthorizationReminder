# EasyConnect 本地环境异常诊断记录

- 时间：2026-07-14
- 系统：macOS 26.2（25C56），Apple Silicon / arm64
- EasyConnect：7.6.7（CFBundleVersion 6），主程序为 x86_64，通过 Rosetta 运行
- 现象：登录页显示“本地环境出现异常”
- 已确认：EasyConnect/Electron 界面进程正在运行
- 已确认：EasyConnect 引用的本地 ECAgent 地址使用 127.0.0.1:54530，但该端口没有监听进程
- 已确认：未发现 ECAgent、EasyMonitor、svpn 等 EasyConnect 本地服务进程
- 共存组件：/Library/sangfor 下的 aTrustAgent、aTrustXtunnel、eaio_service、eaio_agent 正在运行
- 当前判断：优先怀疑旧版 Intel EasyConnect 与 macOS 26 / Apple Silicon 不兼容，或 EasyConnect 本地代理未安装/未启动；aTrust/EAIO 共存也可能造成组件冲突
- 进一步确认：应用内存在 ECAgent、ECAgentProxy、svpnservice，但没有对应运行进程；用户域也没有注册 com.sangfor.ECAgentProxy 启动服务
- 进一步确认：应用包内有 3 个无人占用的陈旧 Unix Socket，导致 codesign/spctl 校验返回 unsupported resource
- 官方依据：深信服把 ECAgent 未运行、通常使用的 54530 端口未监听列为重点原因；登录项禁用也会导致该服务未启动
- 安全边界：不采用关闭 SIP、防火墙或全局 Gatekeeper 的高风险排查方法
- 尚未执行：重启服务、卸载、重新安装、修改系统网络扩展或权限
