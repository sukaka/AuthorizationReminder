from __future__ import annotations

import re
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
    "apache-2.0": LicensePolicy("Apache-2.0", "Apache License 2.0", "该协议不包含实质性的限制条款。", "责任,担保,商标使用", "许可证和版权声明,状态更改", "商业使用,分发,修改,私人使用,专利使用", "兼容", "是", "是", "低风险", "Apache License 2.0 是宽松型许可证，需保留版权和许可证声明。"),
    "mit": LicensePolicy("MIT", "MIT License", "该协议限制较少，主要要求保留版权和许可证声明。", "责任,担保", "许可证和版权声明", "商业使用,分发,修改,私人使用", "兼容", "是", "是", "低风险", "MIT License 是常见宽松型许可证，适合商业使用但需保留声明。"),
    "mit-0": LicensePolicy("MIT-0", "MIT No Attribution", "该协议不包含实质性的限制条款。", "责任,担保", "许可证和版权声明,状态更改", "商业使用,分发,修改,私人使用", "兼容", "是", "否", "低风险", "MIT-0 是无需署名的 MIT 变体，仍建议保留来源证据。"),
    "isc": LicensePolicy("ISC", "ISC License", "该协议不包含实质性的限制条款。", "责任,担保", "许可证和版权声明", "商业使用,分发,修改,私人使用", "兼容", "是", "是", "低风险", "ISC License 是宽松型许可证。"),
    "bsd-2-clause": LicensePolicy("BSD-2-Clause", 'BSD 2-Clause "Simplified" License', "该协议不包含实质性的限制条款。", "责任,担保", "许可证和版权声明", "商业使用,分发,修改,私人使用", "兼容", "是", "是", "低风险", "BSD-2-Clause 是宽松型许可证。"),
    "bsd-3-clause": LicensePolicy("BSD-3-Clause", 'BSD 3-Clause "New" or "Revised" License', "该协议不包含实质性的限制条款。", "责任,担保", "许可证和版权声明,不得使用原作者名称背书", "商业使用,分发,修改,私人使用", "兼容", "是", "是", "低风险", "BSD-3-Clause 要求不得用原作者或贡献者名称为衍生产品背书。"),
    "bsd-4-clause": LicensePolicy("BSD-4-Clause", 'BSD 4-Clause "Original" or "Old" License', "包含广告条款，建议关注再分发要求。", "责任,担保", "许可证和版权声明,广告条款", "商业使用,分发,修改,私人使用", "待确认", "否", "是", "中风险", "BSD-4-Clause 较少使用，广告条款可能带来合规负担。"),
    "cc0-1.0": LicensePolicy("CC0-1.0", "Creative Commons Zero v1.0 Universal", "除了不授予专利权，该协议不包含实质性的限制条款。", "责任,担保", "许可证和版权声明,状态更改", "商业使用,分发,修改,私人使用,专利使用", "兼容", "否", "是", "低风险", "CC0-1.0 通常限制较少，但需保留来源和声明证据。"),
    "gpl-2.0-only": LicensePolicy("GPL-2.0-only", "GNU General Public License v2.0 only", "强 copyleft 协议，分发衍生作品时通常需要公开源码。", "版权,源码公开", "许可证和版权声明,公开代码,相同许可证", "商业使用,分发,修改,私人使用", "兼容", "是", "是", "高风险", "GPL-2.0-only 对再分发和衍生作品有较强约束。"),
    "gpl-2.0-or-later": LicensePolicy("GPL-2.0-or-later", "GNU General Public License v2.0 or later", "强 copyleft 协议，可选择 GPL 后续版本，需重点复核分发义务。", "版权,源码公开", "许可证和版权声明,公开代码,相同许可证", "商业使用,分发,修改,私人使用", "兼容", "是", "是", "高风险", "GPL-2.0-or-later 允许使用 GPL 后续版本，合规判断需结合实际使用方式。"),
    "gpl-3.0-only": LicensePolicy("GPL-3.0-only", "GNU General Public License v3.0 only", "强 copyleft 协议，包含专利和反规避条款。", "版权,源码公开,专利", "许可证和版权声明,公开代码,相同许可证", "商业使用,分发,修改,私人使用,专利使用", "兼容", "是", "是", "高风险", "GPL-3.0-only 对分发、专利授权和反规避有更明确要求。"),
    "gpl-3.0-or-later": LicensePolicy("GPL-3.0-or-later", "GNU General Public License v3.0 or later", "强 copyleft 协议，可选择 GPL 后续版本，包含专利和反规避条款。", "版权,源码公开,专利", "许可证和版权声明,公开代码,相同许可证", "商业使用,分发,修改,私人使用,专利使用", "兼容", "是", "是", "高风险", "GPL-3.0-or-later 需结合分发和衍生作品场景重点复核。"),
    "agpl-3.0-only": LicensePolicy("AGPL-3.0-only", "GNU Affero General Public License v3.0 only", "网络服务场景也可能触发源码公开义务，需重点复核。", "版权,源码公开,网络服务", "许可证和版权声明,公开代码,相同许可证", "商业使用,分发,修改,私人使用,专利使用", "兼容", "是", "是", "高风险", "AGPL-3.0 对 SaaS/网络交互场景约束更强。"),
    "lgpl-2.1-only": LicensePolicy("LGPL-2.1-only", "GNU Lesser General Public License v2.1 only", "弱 copyleft 协议，通过修改或静态链接方式使用时需关注源码公开义务。", "责任,担保", "许可证和版权声明,公开代码,相似许可证", "商业使用,分发,修改,私人使用", "不兼容", "是", "是", "中风险", "LGPL-2.1-only 对库本身修改的公开义务更强。"),
    "lgpl-2.1-or-later": LicensePolicy("LGPL-2.1-or-later", "GNU Lesser General Public License v2.1 or later", "弱 copyleft 协议，可选择 LGPL 后续版本，需关注链接方式和再分发义务。", "责任,担保", "许可证和版权声明,状态更改", "商业使用,分发,修改,私人使用", "兼容", "是", "是", "中风险", "LGPL-2.1-or-later 需结合链接方式、组件修改和分发场景复核。"),
    "lgpl-3.0-only": LicensePolicy("LGPL-3.0-only", "GNU Lesser General Public License v3.0 only", "弱 copyleft 协议，需关注链接方式、组件修改和再分发义务。", "版权,源码公开,专利", "许可证和版权声明,公开 LGPL 组件修改", "商业使用,分发,修改,私人使用,专利使用", "不兼容", "是", "是", "中风险", "LGPL-3.0-only 包含 GPL-3.0 的部分专利和反规避要求。"),
    "lgpl-3.0-or-later": LicensePolicy("LGPL-3.0-or-later", "GNU Lesser General Public License v3.0 or later", "弱 copyleft 协议，可选择 LGPL 后续版本，需关注链接方式和专利条款。", "版权,源码公开,专利", "许可证和版权声明,状态更改", "商业使用,分发,修改,私人使用,专利使用", "兼容", "是", "是", "中风险", "LGPL-3.0-or-later 需结合链接方式、组件修改和分发场景复核。"),
    "epl-1.0": LicensePolicy("EPL-1.0", "Eclipse Public License 1.0", "重新发布修改代码通常需要公开源码。", "责任,担保,专利", "许可证和版权声明,公开代码,相似许可证", "商业使用,分发,修改,私人使用,专利使用", "兼容", "是", "是", "中风险", "EPL-1.0 是弱 copyleft 协议。"),
    "epl-2.0": LicensePolicy("EPL-2.0", "Eclipse Public License 2.0", "重新发布修改代码通常需要公开源码。", "责任,担保,专利", "许可证和版权声明,公开代码,相似许可证", "商业使用,分发,修改,私人使用,专利使用", "兼容", "是", "是", "中风险", "EPL-2.0 支持次级许可证声明，需结合使用方式判断。"),
    "cddl-1.0": LicensePolicy("CDDL-1.0", "Common Development and Distribution License 1.0", "文件级 copyleft 协议，修改文件再分发时需公开对应源码。", "责任,担保,商标使用,专利使用", "许可证和版权声明,公开代码,相似许可证", "商业使用,分发,修改,私人使用", "不兼容", "是", "是", "中风险", "CDDL-1.0 与 GPL 兼容性需重点复核。"),
    "cddl-1.1": LicensePolicy("CDDL-1.1", "Common Development and Distribution License 1.1", "文件级 copyleft 协议，修改文件再分发时需公开对应源码。", "责任,担保,商标使用,专利使用", "许可证和版权声明,公开代码,相似许可证", "商业使用,分发,修改,私人使用", "不兼容", "是", "否", "中风险", "CDDL-1.1 对专利终止等条款有更新。"),
    "elastic-2.0": LicensePolicy("Elastic-2.0", "Elastic License 2.0", "限制将产品作为托管服务提供给第三方等场景。", "使用、复制、分发和制作衍生作品", "许可证和版权声明,状态更改", "不得作为托管服务提供,不得规避许可证功能,不得移除许可声明", "待确认", "否", "否", "中风险", "Elastic License 2.0 不是 OSI 开源许可证，应结合业务场景复核。"),
    "mpl-1.1": LicensePolicy("MPL-1.1", "Mozilla Public License 1.1", "文件级弱 copyleft 协议，修改受 MPL 覆盖文件通常需要公开。", "责任,担保,商标使用,专利使用", "许可证和版权声明,公开代码,相似许可证", "商业使用,分发,修改,私人使用", "不兼容", "是", "是", "低风险", "MPL-1.1 需按文件级别关注源码公开义务。"),
    "mpl-2.0": LicensePolicy("MPL-2.0", "Mozilla Public License 2.0", "文件级弱 copyleft 协议，修改受 MPL 覆盖文件通常需要公开。", "责任,担保,商标使用,专利使用", "许可证和版权声明,公开代码,相似许可证", "商业使用,分发,修改,私人使用", "兼容", "是", "是", "低风险", "MPL-2.0 是常见弱 copyleft 协议。"),
    "mulanpsl-2.0": LicensePolicy("MulanPSL-2.0", "Mulan Permissive Software License, Version 2", "该协议不包含实质性的限制条款。", "责任,担保,商标使用,专利使用", "许可证和版权声明,公开代码", "商业使用,分发,修改,私人使用", "不兼容", "是", "否", "低风险", "木兰宽松许可证第 2 版是国内常见开源许可证，需保留版权和许可证声明。"),
    "wtfpl": LicensePolicy("WTFPL", "Do What The F*ck You Want To Public License", "限制极少但企业合规场景建议人工确认来源和适用性。", "待确认", "待确认", "待确认", "待确认", "否", "否", "需人工确认", "WTFPL 较少作为企业标准白名单许可证，建议人工复核。"),
    "public domain": LicensePolicy("Public Domain", "Public Domain", "通常限制较少，但需确认具体声明来源。", "责任,担保", "待确认", "商业使用,分发,修改,私人使用", "兼容", "待确认", "待确认", "低风险", "Public Domain 类声明应保留来源证据。"),
}

LICENSE_ALIASES = {
    "apache20": "Apache-2.0",
    "apache2": "Apache-2.0",
    "apachelicense20": "Apache-2.0",
    "apachesoftwarelicense": "Apache-2.0",
    "apachelicenseversion20": "Apache-2.0",
    "bsd2clause": "BSD-2-Clause",
    "bsd2clausesimplified": "BSD-2-Clause",
    "bsdlicense2clause": "BSD-2-Clause",
    "bsd3clause": "BSD-3-Clause",
    "bsd3clauseneworrevised": "BSD-3-Clause",
    "bsdlicense3clause": "BSD-3-Clause",
    "bsd4clause": "BSD-4-Clause",
    "cc010": "CC0-1.0",
    "creativecommonszerov10universal": "CC0-1.0",
    "cddl10": "CDDL-1.0",
    "cddl11": "CDDL-1.1",
    "elastic20": "Elastic-2.0",
    "elasticlicense20": "Elastic-2.0",
    "epl10": "EPL-1.0",
    "eclipsepubliclicense10": "EPL-1.0",
    "epl20": "EPL-2.0",
    "eclipsepubliclicense20": "EPL-2.0",
    "gpl20": "GPL-2.0-only",
    "gpl2": "GPL-2.0-only",
    "gpl20only": "GPL-2.0-only",
    "gpl20orlater": "GPL-2.0-or-later",
    "gnugeneralpubliclicensev20": "GPL-2.0-only",
    "gpl30": "GPL-3.0-only",
    "gpl3": "GPL-3.0-only",
    "gpl30only": "GPL-3.0-only",
    "gpl30orlater": "GPL-3.0-or-later",
    "gnugeneralpubliclicensev30": "GPL-3.0-only",
    "agpl30": "AGPL-3.0-only",
    "agpl30only": "AGPL-3.0-only",
    "gnuafferogeneralpubliclicensev30": "AGPL-3.0-only",
    "lgpl21": "LGPL-2.1-only",
    "lgpl21only": "LGPL-2.1-only",
    "lgpl21orlater": "LGPL-2.1-or-later",
    "gnulessergeneralpubliclicensev21": "LGPL-2.1-only",
    "lgpl30": "LGPL-3.0-only",
    "lgpl30only": "LGPL-3.0-only",
    "lgpl30orlater": "LGPL-3.0-or-later",
    "gnulessergeneralpubliclicensev30": "LGPL-3.0-only",
    "mit": "MIT",
    "mitlicense": "MIT",
    "mit0": "MIT-0",
    "mitnoattribution": "MIT-0",
    "isc": "ISC",
    "isclicense": "ISC",
    "mpl11": "MPL-1.1",
    "mozillapubliclicense11": "MPL-1.1",
    "mpl20": "MPL-2.0",
    "mozillapubliclicense20": "MPL-2.0",
    "mulanpsl20": "MulanPSL-2.0",
    "mulanpermissivesoftwarelicenseversion2": "MulanPSL-2.0",
    "mulanpermissivesoftwarelicensev2": "MulanPSL-2.0",
    "wtfpl": "WTFPL",
    "publicdomain": "Public Domain",
}

UNKNOWN_LICENSE_NAMES = {"", "unknown", "none", "null", "n/a", "na", "待确认", "未知", "未声明", "license"}
RISK_ORDER = {"低风险": 1, "中风险": 2, "高风险": 3, "需人工确认": 4}


def _alias_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower().replace("+", "or-later"))


def _normalize_single_license(value: str) -> str:
    text = (value or "").strip().strip("()[]")
    lower = text.lower()
    if lower in UNKNOWN_LICENSE_NAMES:
        return UNKNOWN_LICENSE.short_name
    direct_key = lower.replace("_", "-")
    if direct_key in LICENSE_POLICIES:
        return LICENSE_POLICIES[direct_key].short_name
    alias = LICENSE_ALIASES.get(_alias_key(text))
    if alias:
        return alias
    if "apache" in lower and "2" in lower:
        return "Apache-2.0"
    if "bsd" in lower and "4" in lower:
        return "BSD-4-Clause"
    if "bsd" in lower and "3" in lower:
        return "BSD-3-Clause"
    if "bsd" in lower and "2" in lower:
        return "BSD-2-Clause"
    if "affero" in lower or "agpl" in lower:
        return "AGPL-3.0-only"
    if "lgpl" in lower or "lesser general public license" in lower:
        version = "3.0" if "3" in lower else "2.1"
        suffix = "or-later" if "or later" in lower or lower.endswith("+") else "only"
        return f"LGPL-{version}-{suffix}"
    if "gpl" in lower or "general public license" in lower:
        version = "3.0" if "3" in lower else "2.0"
        suffix = "or-later" if "or later" in lower or lower.endswith("+") else "only"
        return f"GPL-{version}-{suffix}"
    return text


def normalize_license_name(value: str) -> str:
    text = (value or "").strip()
    if text.lower() in UNKNOWN_LICENSE_NAMES:
        return UNKNOWN_LICENSE.short_name
    parts = re.split(r"\s+(AND|OR|WITH)\s+", text, flags=re.IGNORECASE)
    if len(parts) > 1:
        normalized: list[str] = []
        for part in parts:
            if part.upper() in {"AND", "OR", "WITH"}:
                normalized.append(part.upper())
            else:
                normalized.append(_normalize_single_license(part))
        return " ".join(item for item in normalized if item)
    return _normalize_single_license(text)


def is_unknown_license(value: str) -> bool:
    return normalize_license_name(value) == UNKNOWN_LICENSE.short_name


def _expression_parts(text: str) -> list[str]:
    if not re.search(r"\s+(AND|OR|WITH)\s+", text, flags=re.IGNORECASE):
        return []
    return [
        item.strip()
        for item in re.split(r"\s+(?:AND|OR|WITH)\s+", text, flags=re.IGNORECASE)
        if item.strip()
    ]


def license_policy(value: str) -> LicensePolicy:
    text = normalize_license_name(value)
    key = text.lower()
    if key in LICENSE_POLICIES:
        return LICENSE_POLICIES[key]
    parts = _expression_parts(text)
    if parts:
        policies = [license_policy(part) for part in parts]
        highest = max(policies, key=lambda item: RISK_ORDER.get(item.risk_level, 4))
        return LicensePolicy(
            text,
            f"{text}（复合许可证表达式）",
            "组件声明了复合许可证表达式，需结合 AND/OR 条件和实际使用方式复核。",
            "、".join(dict.fromkeys(item.scope for item in policies)),
            "、".join(dict.fromkeys(item.conditions for item in policies)),
            "、".join(dict.fromkeys(item.limitations for item in policies)),
            "待确认",
            "待确认",
            "待确认",
            highest.risk_level,
            "复合许可证表达式已自动标准化，合规判断需结合具体选择条件和分发方式。",
        )
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


def license_requires_review(value: str) -> bool:
    policy = license_policy(value)
    return policy.short_name == UNKNOWN_LICENSE.short_name or policy.risk_level == "需人工确认"
