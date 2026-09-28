import type { EvidenceLayer, SelectedEvidence } from "../evaluation";

/**
 * 确定性 ASCII 序字符串比较（不用 localeCompare：跨运行时/区域设置稳定），
 * 幂等键与证据排序都依赖它的稳定性。
 */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * selector 分组内「最新 revision 优先」的比较键。material-change 与
 * direction-confidence 此前各有一份逐字相同的实现，收敛于此。
 */
export function compareSelectedLatestFirst(left: SelectedEvidence, right: SelectedEvidence): number {
  return compareText(left.selectorId, right.selectorId)
    || compareText(right.observedAt, left.observedAt)
    || right.revision - left.revision
    || compareText(left.evidenceId, right.evidenceId);
}

/**
 * 统一的 4×EPSILON 缩放容差（D3 签字口径，threshold-worksheet §5）：|实际 − 要求| 不超过
 * 该容差即视为「恰好相等」。容差随参与运算数值的量级缩放（下限 1），只吸收 IEEE754 表示
 * 误差，不会翻转任何真实研究决定。numeric_compare（rule-predicate）与修订达标判定
 * （material-change 的 meetsInclusiveDelta）共用此定义，消除两处边界口径分裂。
 */
export function scaledEpsilonTolerance(...magnitudes: readonly number[]): number {
  return Number.EPSILON * Math.max(1, ...magnitudes.map((magnitude) => Math.abs(magnitude))) * 4;
}

const EVIDENCE_LAYER_ORDER: readonly EvidenceLayer[] = [
  "forecast",
  "weather",
  "physical",
  "balance",
  "market",
  "control",
];

/**
 * 按证据层规范顺序排序（稳定排序，不去重）。原 direction-confidence 变体先做 Set 去重，
 * stage-gate 变体不去重；两者的全部输入都是 seed 解码器 uniqueStrings 校验过的
 * requiredEvidenceLayers / gate.requiredLayers 的子集（filter 派生不会引入重复），
 * 去重对所有可达输入都是无操作，故合并为单一实现。
 */
export function sortedLayers(layers: readonly EvidenceLayer[]): readonly EvidenceLayer[] {
  return [...layers].sort(
    (left, right) => EVIDENCE_LAYER_ORDER.indexOf(left) - EVIDENCE_LAYER_ORDER.indexOf(right),
  );
}
