const trimText = (value) => (value === undefined || value === null ? '' : String(value).trim());

const toArray = (value) => (Array.isArray(value) ? value : []);

const normalizeBoolLike = (value) => {
  const text = trimText(value).toLowerCase();
  return ['1', 'true', 'yes', 'y', '是'].includes(text);
};

const inferSatisfyStatus = ({ response = '', deviation = '' }) => {
  const responseText = trimText(response);
  const deviationText = trimText(deviation);
  if (/不满足|不支持|无法满足/.test(responseText) || (/偏离/.test(deviationText) && !/无偏离/.test(deviationText))) {
    return 'NOT_SATISFIED';
  }
  if (/满足|支持|符合|无偏离|完全响应/.test(`${responseText}\n${deviationText}`)) {
    return 'SATISFIED';
  }
  return 'TO_CONFIRM';
};

const inferEvidenceSource = (requirementText = '') => {
  const text = trimText(requirementText);
  if (!text) return '待补证据来源';
  if (/授权|原厂/.test(text)) return '授权文件库';
  if (/项目经理|人员|工程师|证书|资质/.test(text)) return '人员/资质证书库';
  if (/案例|业绩|合同/.test(text)) return '业绩案例库';
  if (/参数|技术|型号|品牌|性能/.test(text)) return '产品参数表';
  if (/实施|售后|服务|培训|应急/.test(text)) return '实施与服务方案';
  return '综合材料库';
};

const inferRiskLevel = ({ mandatory = false, invalidOnNegative = false, satisfyStatus = 'TO_CONFIRM' }) => {
  if ((mandatory || invalidOnNegative) && satisfyStatus !== 'SATISFIED') return 'HIGH';
  if (satisfyStatus === 'TO_CONFIRM') return 'MEDIUM';
  return 'LOW';
};

const buildRow = ({
  itemNo,
  requirement,
  response,
  deviation,
  mandatory = false,
  invalidOnNegative = false,
}) => {
  const satisfyStatus = inferSatisfyStatus({ response, deviation });
  const riskLevel = inferRiskLevel({
    mandatory,
    invalidOnNegative,
    satisfyStatus,
  });
  const manualReviewRequired = riskLevel === 'HIGH' || satisfyStatus === 'TO_CONFIRM';
  const evidenceSource = inferEvidenceSource(requirement);
  return {
    item_no: trimText(itemNo),
    tender_requirement: trimText(requirement),
    bidder_response: trimText(response) || '待补充响应',
    deviation_note: trimText(deviation) || '无偏离',
    satisfy_status: satisfyStatus,
    evidence_source: evidenceSource,
    risk_level: riskLevel,
    manual_review_required: manualReviewRequired,
  };
};

const buildDeviationAndResponseTables = ({ bidCategory = 'SERVICE', finalJson = {} }) => {
  const category = trimText(bidCategory).toUpperCase() === 'PRODUCT' ? 'PRODUCT' : 'SERVICE';
  const detail = category === 'PRODUCT'
    ? (finalJson?.goods_procurement_detail || {})
    : (finalJson?.service_procurement_detail || {});
  const business = finalJson?.business_performance_rules || {};

  const technicalRows = [];
  const businessRows = [];

  if (category === 'PRODUCT') {
    const techRows = Array.isArray(finalJson?.technical_deviation_table) ? finalJson.technical_deviation_table : [];
    techRows.forEach((item, index) => {
      technicalRows.push(buildRow({
        itemNo: item?.item_no || item?.param_no || `${index + 1}`,
        requirement: item?.tender_requirement || item?.param_requirement || item?.param_name,
        response: item?.bid_response || item?.bidder_response || '待补充响应',
        deviation: item?.deviation || item?.deviation_note || '无偏离',
        mandatory: normalizeBoolLike(item?.is_mandatory),
        invalidOnNegative: normalizeBoolLike(item?.negative_deviation_invalid),
      }));
    });
  } else {
    const slaRows = toArray(detail?.core_sla_indicators);
    slaRows.forEach((item, index) => {
      technicalRows.push(buildRow({
        itemNo: item?.item_no || `${index + 1}`,
        requirement: item?.indicator_requirement,
        response: '已响应，详见服务水平承诺章节',
        deviation: '无偏离',
        mandatory: false,
        invalidOnNegative: false,
      }));
    });
    toArray(detail?.service_implementation_requirements).forEach((item, index) => {
      technicalRows.push(buildRow({
        itemNo: `IMP-${index + 1}`,
        requirement: item,
        response: '已响应，详见实施方案章节',
        deviation: '无偏离',
      }));
    });
  }

  const pushBusinessRow = (itemNo, requirement, response = '已响应，详见商务响应章节', deviation = '无偏离') => {
    const row = buildRow({
      itemNo,
      requirement,
      response,
      deviation,
      mandatory: /必须|不得|应当/.test(trimText(requirement)),
      invalidOnNegative: /无效投标|废标|否决/.test(trimText(requirement)),
    });
    if (!trimText(row.tender_requirement) || row.tender_requirement === '未明确') return;
    businessRows.push(row);
  };

  pushBusinessRow('BUS-1', business.payment_terms, '已响应，详见付款条款响应');
  pushBusinessRow('BUS-2', business.performance_bond_rules, '已响应，详见履约保证金承诺');
  pushBusinessRow('BUS-3', business.intellectual_property_rules, '已响应，详见知识产权与保密承诺');
  pushBusinessRow('BUS-4', business.liability_for_breach_of_contract, '已响应，详见违约责任响应');
  pushBusinessRow('BUS-5', business.renewal_rules, '已响应，详见续约条款响应');
  toArray(business.other_business_rules).forEach((item, index) => {
    pushBusinessRow(`BUS-EX-${index + 1}`, item);
  });

  const technical = technicalRows.filter((row) => trimText(row.tender_requirement)).slice(0, 120);
  const businessFiltered = businessRows.filter((row) => trimText(row.tender_requirement)).slice(0, 120);
  const toResponseRow = (row) => ({
    item_no: row.item_no,
    tender_requirement: row.tender_requirement,
    our_response: row.bidder_response,
    deviation: row.deviation_note,
    evidence_source: row.evidence_source,
    manual_review_required: row.manual_review_required,
  });

  return {
    deviation_tables: {
      technical,
      business: businessFiltered,
    },
    response_tables: {
      technical: technical.map(toResponseRow),
      business: businessFiltered.map(toResponseRow),
    },
  };
};

module.exports = {
  buildDeviationAndResponseTables,
  inferSatisfyStatus,
  inferEvidenceSource,
};
