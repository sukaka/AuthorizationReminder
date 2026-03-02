USE cmdb;
SET NAMES utf8mb4;

UPDATE cmdb_model_template
SET name = '主机模型', icon = '◍', description = '用于 Linux/Windows 主机资产'
WHERE model_uid = '01JMMODELHOST0000000000001';

UPDATE cmdb_model_template
SET name = '数据库模型', icon = '◎', description = '用于 MySQL/PostgreSQL/Oracle 等数据库实例'
WHERE model_uid = '01JMMODELDB000000000000001';

UPDATE cmdb_model_template
SET name = '中间件模型', icon = '◉', description = '用于消息队列、缓存、注册中心等中间件'
WHERE model_uid = '01JMMODELMW000000000000001';

UPDATE cmdb_model_template
SET name = '网络与环境模型', icon = '◌', description = '用于交换机、路由器、防火墙和网络环境资产'
WHERE model_uid = '01JMMODELENV00000000000001';

UPDATE cmdb_model_template
SET name = '应用模型', icon = '◇', description = '用于业务应用与服务实例'
WHERE model_uid = '01JMMODELAPP00000000000001';

UPDATE cmdb_model_field_rule
SET field_label = 'IP地址'
WHERE field_uid = '01JMFIELDHOSTIP00000000001';

UPDATE cmdb_model_field_rule
SET field_label = 'CPU规格'
WHERE field_uid = '01JMFIELDHOSTCPU0000000001';

UPDATE cmdb_model_field_rule
SET field_label = '内存'
WHERE field_uid = '01JMFIELDHOSTMEM0000000001';

UPDATE cmdb_model_field_rule
SET field_label = '数据库引擎'
WHERE field_uid = '01JMFIELDDBENGINE000000001';

UPDATE cmdb_model_field_rule
SET field_label = '端口'
WHERE field_uid = '01JMFIELDDBPORT00000000001';

UPDATE discovery_task
SET name = '主机资产巡检发现', owner = 'CMDB平台', schedule_text = '每天 02:00'
WHERE task_uid = '01JMDISCOVERHOST0000000001';

UPDATE discovery_task
SET name = '数据库资产快速发现', owner = 'DBA团队', schedule_text = '每 4 小时'
WHERE task_uid = '01JMDISCOVERDB000000000001';
