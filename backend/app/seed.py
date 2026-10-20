"""Original, explicitly labelled sample material. No model output is claimed here."""

from sqlalchemy import select

from . import schemas as dto
from .domain import uid
from .library import Library
from .models import Novel

SAMPLE = [
    ("第一章 回到雾港", "让林舟重返故乡，建立寻找父亲的动机。",
     "林舟下船时，雾还没有散。码头的旧钟停在三点十七分，守夜人说，停了整整七年。\n\n"
     "他拖着箱子走过鱼市，箱底藏着父亲最后寄来的明信片。背面只有一句话：不要相信没有影子的人。\n\n"
     "这次回来，他要查清林远山失踪的原因。"),
    ("第二章 航海图", "找到父亲留下的图纸。",
     "老屋的钥匙仍放在门框上。林舟推门进去，墙上的潮痕比记忆中更高。\n\n"
     "书桌的暗格里有一张航海图。纸页边缘磨得发白，北岸附近被人用铅笔圈了起来。\n\n"
     "林舟把航海图卷好，放进随身的皮筒。"),
    ("第三章 值守人", "认识旧邮局的沈知微。",
     "旧邮局只亮着一盏灯。柜台后的女人正在登记一叠无邮戳的信。\n\n"
     "“沈知微。”她报出自己的名字，“你父亲曾经替这里修过地图。”\n\n"
     "林舟第一次听到有人承认认识父亲。他记住了沈知微的名字。"),
    ("第四章 缺角的圆", "埋下航海图上的印记。",
     "他在窗边展开航海图。铅笔圈的背面，还藏着一个缺了一角的圆。\n\n"
     "那个缺口指向北岸，旁边没有任何说明。林舟用手指沿着印记描了一遍。\n\n"
     "他拍下了印记，却没有把照片发给任何人。"),
    ("第五章 旧钟楼", "让停摆的钟与父亲留下的时间发生联系。",
     "钟楼的台阶比他想象中更窄。上到最后一级，海雾从破窗里伸进来。\n\n"
     "钟机里卡着半截铅笔，笔杆刻着父亲的姓。林舟没有转动齿轮，只把位置记在本子上。\n\n"
     "离开钟楼后，他带着航海图回到旧邮局。"),
    ("第六章 无人认领的信", "收到带有同样印记的来信。",
     "沈知微把一封未署名的信推到桌上。她说，送信的人没有留下姓名。\n\n"
     "林舟把信封翻了过来。红色火漆中央，正是航海图上那个缺了一角的圆。\n\n"
     "他没有拆信，而是把它和航海图一起收进皮筒。窗外又开始下雨。"),
    ("第七章 雨夜的访客", "让访客带来一个与父亲有关的线索。",
     "雨停在凌晨两点。林舟推开旧邮局的门，听见走廊深处传来一声很轻的咳嗽。\n\n"
     "柜台后的女人没有抬头，只把一封信推到灯下。信封已经泛黄，红色火漆却像刚刚凝固。\n\n"
     "那枚印记，他在父亲留下的航海图上见过。\n\n"
     "林舟没有立刻伸手去拿。他看着女人干枯的手指，指节上有细小的墨渍。油灯在她侧脸投下一道模糊的影子。\n\n"
     "“你来得比我想的要晚。”她终于开口，声音很轻，却像在空旷的房间里回荡。"),
    ("第八章 潮汐之前", "让林舟决定是否前往北岸。", ""),
    ("第九章 来自北岸", "检验航海图给出的方向。", ""),
    ("第十章 雾后的灯", "让第一卷的线索得到阶段性回应。", ""),
]


def create_demo(library: Library) -> dto.NovelOut:
    with library.ws.session() as session:
        existing = session.scalar(select(Novel.id).where(Novel.is_demo.is_(True), Novel.archived.is_(False)))
    if existing:
        return library.novel(existing)
    novel = library.create_novel(dto.NovelInput(title="雾港来信", genre="悬疑",
        premise="一封没有署名的信，把离开故乡多年的林舟带回了雾港。有人知道他父亲失踪的真相。",
        style="第三人称限制视角。克制、具体，让人物的选择与细节推动悬疑，避免提前解释秘密。"), is_demo=True)
    for name, summary, body, kind, status in [
        ("林舟", "地图修复师，回到故乡寻找父亲。", "核心目标：查清父亲失踪的原因。\n行事习惯：先核实证据，再做决定。", "character", "author"),
        ("沈知微", "旧邮局值守人。", "认识林舟的父亲，保管未署名的来信。", "character", "author"),
        ("林远山", "林舟的父亲，目前下落不明。", "留下航海图与一封明信片。失踪不等于死亡。", "character", "author"),
        ("雨夜访客", "来自第七章草稿的候选人物。", "真实身份尚未确定，不能作为已确认前情。", "character", "proposed"),
        ("旧邮局", "雾港的旧邮政所。", "保留纸质信件登记与旧灯。世界规则由作者决定。", "world", "author"),
        ("缺角的圆", "航海图和红色火漆共有的印记。", "埋设：第四章；呼应：第六章。真实含义仍待揭示。", "thread", "author"),
    ]:
        library.put_entity(novel.id, dto.EntityInput(name=name, summary=summary, body=body,
                                                    kind=kind, status=status))
    for index, (title, goal, body) in enumerate(SAMPLE):
        chapter = library.create_chapter(novel.id, dto.ChapterInput(title=title, goal=goal))
        if body:
            version = library.save(novel.id, chapter.id, dto.SaveInput(
                base_version_id=chapter.working_version_id, operation_id=uid("seed"), text=body))
            if index < 6:
                paragraph = version.paragraphs[-1]
                proposal = dto.MemoryProposal(subject="本章记录", claim=paragraph.text,
                    evidence=[dto.Evidence(source_id=f"{version.id}:{paragraph.paragraph_id}", quote=paragraph.text)])
                library.confirm(novel.id, chapter.id, dto.CanonInput(version_id=version.id,
                    operation_id=uid("canon_seed"), changes=[proposal]))
        library.put_plan(novel.id, dto.PlanInput(title=title, body=goal, level="chapter"))
    return library.novel(novel.id)
