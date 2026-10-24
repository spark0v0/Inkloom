import type { Blueprint, Outline } from '../lib/api'

export function BlueprintView({ value }: { value: Blueprint }) {
  return <div className="blueprint-document"><div className="blueprint-logline"><h2>{value.title}</h2><p>{value.logline}</p></div><section><h3>作品简介</h3><p>{value.blurb}</p></section><div className="blueprint-columns"><section><h3>阅读期待</h3><p>{value.reader_promise}</p></section><section><h3>主线冲突</h3><p>{value.main_conflict}</p></section></div><section><h3>主要人物</h3><div className="blueprint-characters">{value.characters.map((c, i) => <article key={i}><span className="character-initial">{Array.from(c.name)[0]}</span><div><h4>{c.name}<small>{c.role}</small></h4><p>{c.motivation}</p><p className="muted">{c.arc}</p></div></article>)}</div></section><section><h3>世界与规则</h3>{value.world.map((w, i) => <p key={i}><strong>{w.name}：</strong>{w.rule}</p>)}</section><section><h3>分卷</h3>{value.volumes.map((v, i) => <div className="blueprint-volume" key={i}><strong>{v.title}</strong><span>计划 {v.planned_chapters} 章</span><p>{v.summary}</p><p className="muted">高潮：{v.climax}</p><p className="muted">卷末：{v.ending_hook}</p></div>)}</section><details><summary>结局方向与文风</summary><p>{value.ending}</p><p>{value.style_guide}</p></details></div>
}

export function OutlineView({ value }: { value: Outline }) {
  return <div className="outline-preview"><h2>{value.volume_title}</h2>{value.chapters.map(c => <article key={c.number}><h3>第{c.number}章 {c.title}</h3><p>{c.goal}</p><dl><dt>冲突</dt><dd>{c.conflict}</dd><dt>情节</dt><dd><ol>{c.beats.map((b, i) => <li key={i}>{b}</li>)}</ol></dd><dt>章末</dt><dd>{c.ending_hook}</dd></dl></article>)}</div>
}
