-- 0009: 覆盖缺口豁免（路径①，2026-09-24 负责人确认）
--
-- 背景：SHIP-EU-01 的唯一 selector 是控制变量（eu-brent-control，control 层 / context 立场），
-- 按设计不得作为方向证据；欧线运价（SCFI/FBX/Drewry）属 A-Ⅲ 商业来源，尚未授权。
-- 该论点因此无法产出可发布版本，而 daily_brief_publish_validate 要求六条必需论点各有版本，
-- 导致 brief 永远无法发布。
--
-- 路径①：允许“已显式标注覆盖缺口”的论点被豁免，缺口在公开页面如实展示（不用代理、不改数据）。
--
-- 本迁移只创建豁免登记表；放宽触发器的部分在后续迁移中完成（需与发布校验、前端确认一起上线，
-- 以免出现“可豁免但无人确认”的中间状态）。

CREATE TABLE daily_brief_exemptions (
  brief_date      TEXT NOT NULL,
  thesis_id       TEXT NOT NULL,
  gap_id          TEXT NOT NULL,
  acknowledged_by TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL,
  PRIMARY KEY (brief_date, thesis_id),
  FOREIGN KEY (brief_date) REFERENCES daily_briefs(brief_date)
);

CREATE INDEX daily_brief_exemptions_by_date ON daily_brief_exemptions(brief_date);
