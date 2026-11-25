import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionOr401 } from '@/lib/auth'

const OFFICIAL_PROMPTS = [
  {
    title: '番茄/起点爆款开篇三秒钩子公式',
    category: '开篇钩子',
    description: '适用于玄幻、都市、系统流第一章开局：直接抛出屈辱/危机/反常事件，500字内亮出金手指。',
    promptText:
      '请用以下“强冲突开篇法”撰写第一章：1) 第一句直接切入危机或打脸现场，禁止大段背景科普；2) 用具体感官细节（雨声、伤痛、嘲讽眼神）立住主角当前困境；3) 500字内触发金手指或底牌反转；4) 章末留下一个必须点开下一章的悬念钩子。核心设定如下：',
    authorName: '笔锋官方',
    useCount: 342,
    likesCount: 128,
    isOfficial: true,
  },
  {
    title: '“去AI味”口语化网文重写指令',
    category: '去AI味',
    description: '消除对称排比、空洞抒情与“然而/不禁/仿佛”等常见AI套话，让行文像人类老作者。',
    promptText:
      '请将下面这段正文进行“真人网文老作者风格”改写：严格禁止出现“然而、不禁、仿佛、不由得、嘴角勾起一抹弧度、宛如画卷”等AI高频套话；多用短句、动词和生活化口语，删掉结尾的总结升华句，把情绪藏在人物小动作里。待改写正文：',
    authorName: '笔锋官方',
    useCount: 519,
    likesCount: 214,
    isOfficial: true,
  },
  {
    title: '长篇百万字分卷大纲架构师',
    category: '大纲模板',
    description: '生成三幕式+阶梯换地图的网文长篇大纲，包含每卷核心反派、境界体系与阶段爽点。',
    promptText:
      '请为我规划一部百万字长篇网文的分卷大纲（共4卷），每卷必须包含：1) 地图与势力格局；2) 本卷核心矛盾与终极BOSS；3) 主角实力晋升路线；4) 3个关键小高潮与1个卷末大反转。题材与灵感如下：',
    authorName: '青云客',
    useCount: 276,
    likesCount: 95,
    isOfficial: true,
  },
  {
    title: '立体反派与“智商在线”配角塑造',
    category: '人物设定',
    description: '告别无脑降智反派，生成有独立动机、行为逻辑自洽、压迫感十足的对手设定。',
    promptText:
      '请帮我设计一个“智商在线、压迫感强”的核心反派，包含：1) 表面人设与真实野心；2) 为什么他/她必须与主角为敌的合理利益冲突；3) 3个标志性小动作或口头禅；4) 他/她最致命的性格弱点（用于主角后续反杀）。背景如下：',
    authorName: '雾夜听风',
    useCount: 198,
    likesCount: 87,
    isOfficial: true,
  },
  {
    title: '极限定位“装逼打脸/情绪反转”节奏模板',
    category: '爽点打磨',
    description: '先抑后扬三步曲：轻视试探 → 亮出底牌 → 全场震骇与余波收尾，专治平淡流水账。',
    promptText:
      '请按照“三步先抑后扬”节奏扩写以下冲突桥段：第一步写旁观者与反派的轻视与嘲讽（铺垫压抑感）；第二步写主角不废话直接出手或亮出凭证（干脆利落）；第三步通过周围配角的瞳孔地震、前后态度对比来侧面烘托爽感。剧情梗概：',
    authorName: '橘子汽水',
    useCount: 410,
    likesCount: 163,
    isOfficial: true,
  },
  {
    title: '高张力潜台词对话生成器',
    category: '对话张力',
    description: '让角色说话“指桑骂槐、暗藏机锋”，避免直白干瘪的信息交代式对话。',
    promptText:
      '请为以下两个角色编写一段 8~12 轮的博弈对话：要求双方都不把真实目的直接说出口，用试探、反问、停顿和动作（如端茶、擦剑、看表）传递心理压迫感，每句台词控制在25字以内。双方信息与冲突：',
    authorName: '白桃乌龙',
    useCount: 164,
    likesCount: 72,
    isOfficial: true,
  },
]

async function ensureSeeded() {
  const count = await (db as any).promptTemplate.count()
  if (count === 0) {
    await (db as any).promptTemplate.createMany({ data: OFFICIAL_PROMPTS })
  }
}

export async function GET(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: 401 })
  }

  await ensureSeeded()

  const url = new URL(req.url)
  const category = url.searchParams.get('category') || ''
  const q = (url.searchParams.get('q') || '').trim()

  const where: any = {}
  if (category && category !== '全部') where.category = category
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { description: { contains: q } },
      { authorName: { contains: q } },
    ]
  }

  const items = await (db as any).promptTemplate.findMany({
    where,
    orderBy: [{ isOfficial: 'desc' }, { useCount: 'desc' }, { createdAt: 'desc' }],
  })

  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: 401 })
  }

  const body = await req.json()
  const { title, category = '大纲模板', description, promptText } = body
  if (!title?.trim() || !description?.trim() || !promptText?.trim()) {
    return NextResponse.json({ error: '标题、简介和提示词内容不能为空' }, { status: 400 })
  }

  const item = await (db as any).promptTemplate.create({
    data: {
      title: title.trim(),
      category,
      description: description.trim(),
      promptText: promptText.trim(),
      authorName: session.user.penName || session.user.name || '匿名作者',
      userId: session.user.id,
      isOfficial: false,
    },
  })

  return NextResponse.json({ item })
}

export async function PATCH(req: NextRequest) {
  const session = await requireSessionOr401()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: 401 })
  }

  const body = await req.json()
  const { id, action } = body
  if (!id || !['use', 'like'].includes(action)) {
    return NextResponse.json({ error: '参数无效' }, { status: 400 })
  }

  const item = await (db as any).promptTemplate.update({
    where: { id },
    data: action === 'use' ? { useCount: { increment: 1 } } : { likesCount: { increment: 1 } },
  })

  return NextResponse.json({ item })
}
