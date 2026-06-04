from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LicensePolicy:
    short_name: str
    full_name: str
    risk_note: str
    scope: str
    conditions: str
    limitations: str
    gpl_compatible: str
    osi_approved: str
    fsf_approved: str
    risk_level: str
    description: str


UNKNOWN_LICENSE = LicensePolicy(
    short_name="未声明",
    full_name="未声明或无法自动识别",
    risk_note="源码或元数据中未提供可识别许可证信息，建议人工复核。",
    scope="需人工确认",
    conditions="需人工确认",
    limitations="需人工确认",
    gpl_compatible="需人工确认",
    osi_approved="需人工确认",
    fsf_approved="需人工确认",
    risk_level="需人工确认",
    description="当前组件未命中内置常见开源许可证规则，平台不自动推断许可证风险。",
)

LICENSE_POLICIES = {
    "apache-2.0": LicensePolicy("Apache-2.0", "Apache License 2.0", "该协议不包含实质性的限制条款。", "责任,担保,商标使用,专利使用", "许可证和版权声明,状态更改", "商业使用,分发,修改,私人使用,专利使用", "兼容", "是", "是", "低风险", "Apache License 2.0 是宽松型许可证，需保留版权和许可证声明。"),
    "mit": LicensePolicy("MIT", "MIT License", "该协议限制较少，主要要求保留版权和许可证声明。", "责任,担保", "许可证和版权声明", "商业使用,分发,修改,私人使用", "兼容", "是", "是", "低风险", "MIT License 是常见宽松型许可证，适合商业使用但需保留声明。"),
    "bsd-2-clause": LicensePolicy("BSD-2-Clause", 'BSD 2-Clause "Simplified" License', "该协议不包含实质性的限制条款。", "责任,担保", "许可证和版权声明", "商业使用,分发,修改,私人使用", "兼容", "是", "是", "低风险", "BSD-2-Clause 是宽松型许可证。"),
    "bsd-3-clause": LicensePolicy("BSD-3-Clause", 'BSD 3-Clause "New" or "Revised" License', "该协议不包含实质性的限制条款。", "责任,担保", "许可证和版权声明,不得使用原作者名称背书", "商业使用,分发,修改,私人使用", "兼容", "是", "是", "低风险", "BSD-3-Clause 要求不得用原作者或贡献者名称为衍生产品背书。"),
    "bsd-4-clause": LicensePolicy("BSD-4-Clause", 'BSD 4-Clause "Original" or "Old" License', "包含广告条款，建议关注再分发要求。", "责任,担保", "许可证和版权声明,广告条款", "商业使用,分发,修改,私人使用", "待确认", "否", "是", "中风险", "BSD-4-Clause 较少使用，广告条款可能带来合规负担。"),
    "gpl-2.0": LicensePolicy("GPL-2.0", "GNU General Public License v2.0", "强 copyleft 协议，分发衍生作品时通常需要公开源码。", "版权,源码公开", "许可证和版权声明,公开代码,相同许可证", "商业使用,分发,修改,私人使用", "兼容", "是", "是", "高风险", "GPL-2.0 对再分发和衍生作品有较强约束。"),
    "gpl-3.0": LicensePolicy("GPL-3.0", "GNU General Public License v3.0", "强 copyleft 协议，包含专利和反规避条款。", "版权,源码公开,专利", "许可证和版权声明,公开代码,相同许可证", "商业使用,分发,修改,私人使用,专利使用", "兼容", "是", "是", "高风险", "GPL-3.0 对分发、专利授权和反规避有更明确要求。"),
    "lgpl-2.1": LicensePolicy("LGPL-2.1", "GNU Lesser General Public License v2.1", "弱 copyleft 协议，动态链接场景风险较低但仍需关注修改和再分发。", "版权,源码公开", "许可证和版权声明,公开 LGPL 组件修改", "商业使用,分发,修改,私人使用", "兼容", "是", "是", "中风险", "LGPL-2.1 对库本身修改的公开义务更强。"),
    "lgpl-3.0": LicensePolicy("LGPL-3.0", "GNU Lesser General Public License v3.0", "弱 copyleft 协议，需关注链接方式、组件修改和再分发义务。", "版权,源码公开,专利", "许可证和版权声明,公开 LGPL 组件修改", "商业使用,分发,修改,私人使用,专利使用", "兼容", "是", "是", "中风险", "LGPL-3.0 包含 GPL-3.0 的部分专利和反规避要求。"),
    "epl-1.0": LicensePolicy("EPL-1.0", "Eclipse Public License 1.0", "重新发布修改代码通常需要公开源码。", "责任,担保,专利", "许可证和版权声明,公开代码,相似许可证", "商业使用,分发,修改,私人使用,专利使用", "兼容", "是", "是", "中风险", "EPL-1.0 是弱 copyleft 协议。"),
    "epl-2.0": LicensePolicy("EPL-2.0", "Eclipse Public License 2.0", "重新发布修改代码通常需要公开源码。", "责任,担保,专利", "许可证和版权声明,公开代码,相似许可证", "商业使用,分发,修改,私人使用,专利使用", "兼容", "是", "是", "中风险", "EPL-2.0 支持次级许可证声明，需结合使用方式判断。"),
    "cddl-1.0": LicensePolicy("CDDL-1.0", "Common Development and Distribution License 1.0", "文件级 copyleft 协议，修改文件再分发时需公开对应源码。", "责任,担保,商标使用,专利使用", "许可证和版权声明,公开代码,相似许可证", "商业使用,分发,修改,私人使用", "不兼容", "是", "是", "中风险", "CDDL-1.0 与 GPL 兼容性需重点复核。"),
    "cddl-1.1": LicensePolicy("CDDL-1.1", "Common Development and Distribution License 1.1", "文件级 copyleft 协议，修改文件再分发时需公开对应源码。", "责任,担保,商标使用,专利使用", "许可证和版权声明,公开代码,相似许可证", "商业使用,分发,修改,私人使用", "不兼容", "是", "否", "中风险", "CDDL-1.1 对专利终止等条款有更新。"),
    "elastic-2.0": LicensePolicy("Elastic-2.0", "Elastic License 2.0", "限制将产品作为托管服务提供给第三方等场景。", "使用、复制、分发和制作衍生作品", "许可证和版权声明,状态更改", "不得作为托管服务提供,不得规避许可证功能,不得移除许可声明", "待确认", "否", "否", "中风险", "Elastic License 2.0 不是 OSI 开源许可证，应结合业务场景复核。"),
    "public domain": LicensePolicy("Public Domain", "Public Domain", "通常限制较少，但需确认具体声明来源。", "责任,担保", "待确认", "商业使用,分发,修改,私人使用", "兼容", "待确认", "待确认", "低风险", "Public Domain 类声明应保留来源证据。"),
}


def normalize_license_name(value: str) -> str:
    text = (value or "").strip()
    return "未声明" if text.lower() in {"", "unknown", "none", "null", "n/a", "na", "待确认", "未知"} else text


def license_policy(value: str) -> LicensePolicy:
    text = normalize_license_name(value)
    key = text.lower()
    if key in LICENSE_POLICIES:
        return LICENSE_POLICIES[key]
    if "mit" == key:
        return LICENSE_POLICIES["mit"]
    if "apache" in key and "2" in key:
        return LICENSE_POLICIES["apache-2.0"]
    if "bsd" in key and "3" in key:
        return LICENSE_POLICIES["bsd-3-clause"]
    if "bsd" in key and "2" in key:
        return LICENSE_POLICIES["bsd-2-clause"]
    if "gpl" in key and "lesser" in key:
        return LICENSE_POLICIES["lgpl-3.0"] if "3" in key else LICENSE_POLICIES["lgpl-2.1"]
    if "lgpl" in key:
        return LICENSE_POLICIES["lgpl-3.0"] if "3" in key else LICENSE_POLICIES["lgpl-2.1"]
    if "gpl" in key:
        return LICENSE_POLICIES["gpl-3.0"] if "3" in key else LICENSE_POLICIES["gpl-2.0"]
    if "public domain" in key:
        return LICENSE_POLICIES["public domain"]
    if text != UNKNOWN_LICENSE.short_name:
        return LicensePolicy(
            text,
            f"{text}（未命中内置规则）",
            UNKNOWN_LICENSE.risk_note,
            UNKNOWN_LICENSE.scope,
            UNKNOWN_LICENSE.conditions,
            UNKNOWN_LICENSE.limitations,
            UNKNOWN_LICENSE.gpl_compatible,
            UNKNOWN_LICENSE.osi_approved,
            UNKNOWN_LICENSE.fsf_approved,
            UNKNOWN_LICENSE.risk_level,
            UNKNOWN_LICENSE.description,
        )
    return UNKNOWN_LICENSE
