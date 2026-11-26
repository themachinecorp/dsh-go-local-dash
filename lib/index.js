// local-dash — a dsh-go native panel for the phone app.
//
// Everything on screen is measured on the host that runs this plugin: process
// uptime, resident memory, how often the app pulled the panel, and the
// per-minute pull curve. Nothing is faked; the panel says so.
//
// The App draws the JSON tree below and calls the handlers when a thing is
// tapped. The App never runs this code.
import os from 'node:os'
import zlib from 'node:zlib'

const BUCKETS = 12

const state = {
  startedAt: Date.now(),
  minutes: new Array(BUCKETS).fill(0),
  minute: Math.floor(Date.now() / 60000),
  pulls: 0,
  beats: 0,
  lag: 0,
}

/** Roll the per-minute window forward; a long gap wipes it. */
function roll(now = Date.now()) {
  const minute = Math.floor(now / 60000)
  const gap = minute - state.minute
  if (gap <= 0) return
  if (gap >= BUCKETS) state.minutes.fill(0)
  else {
    state.minutes.splice(0, gap)
    for (let i = 0; i < gap; i += 1) state.minutes.push(0)
  }
  state.minute = minute
}

/** Count one pull of the panel or strip into the current minute bucket. */
function mark() {
  roll()
  state.minutes[state.minutes.length - 1] += 1
}

function uptimeText(now = Date.now()) {
  const s = Math.max(0, Math.round((now - state.startedAt) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h} 小时 ${m} 分`
  if (m > 0) return `${m} 分 ${sec} 秒`
  return `${sec} 秒`
}

function memText() {
  const rss = process.memoryUsage().rss
  return `${Math.round(rss / 1024 / 1024)} MB`
}

// ---------------------------------------------------------------- png tiles

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const head = Buffer.from(type, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head, data])))
  return Buffer.concat([length, head, data, crc])
}

/** A tiny PNG encoder: enough for the gradient tiles the gallery shows. */
function encodePng(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  let o = 0
  for (let y = 0; y < height; y += 1) {
    raw[o] = 0
    o += 1
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y)
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      o += 3
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const PALETTES = [
  { name: '紫电', from: [124, 58, 237], to: [236, 72, 153] },
  { name: '碧海', from: [13, 148, 136], to: [56, 189, 248] },
  { name: '熔金', from: [217, 119, 6], to: [244, 114, 182] },
  { name: '深海', from: [30, 41, 59], to: [99, 102, 241] },
]

let tiles = null

function gradientTiles() {
  if (tiles !== null) return tiles
  tiles = PALETTES.map(palette => {
    const png = encodePng(160, 110, (x, y) => {
      const t = (x / 159) * 0.65 + (y / 109) * 0.35
      const wave = 0.12 * Math.sin((x + y) / 26)
      const k = Math.min(1, Math.max(0, t + wave))
      return [
        Math.round(palette.from[0] + (palette.to[0] - palette.from[0]) * k),
        Math.round(palette.from[1] + (palette.to[1] - palette.from[1]) * k),
        Math.round(palette.from[2] + (palette.to[2] - palette.from[2]) * k),
      ]
    })
    return {
      name: palette.name,
      src: `data:image/png;base64,${png.toString('base64')}`,
    }
  })
  return tiles
}

// ------------------------------------------------------------------- panel

function diagnostics(now = Date.now()) {
  return [
    'DSH Go 本地仪表盘 · 诊断',
    `主机：${os.hostname()}`,
    `引擎运行时长：${uptimeText(now)}`,
    `常驻内存：${memText()}`,
    `Node：${process.version}`,
    `平台：${process.platform}/${process.arch}`,
    `面板拉取次数：${state.pulls}`,
    `最近 12 分钟拉取：${state.minutes.join(',')}`,
  ].join('\n')
}

function panelView(scope, caps) {
  const supports = name => Array.isArray(caps?.components) && caps.components.includes(name)
  const children = [
    {
      type: 'stack',
      style: { card: 'tinted', padding: 'M', gap: 'S' },
      children: [
        { type: 'text', text: 'DSH GO · 本地引擎', style: { size: 'title', weight: 'bold' } },
        { type: 'text', text: { $: 'data.host' }, style: { size: 'caption' } },
      ],
    },
    {
      type: 'row',
      style: { gap: 'S', columns: 'equal' },
      children: [
        { type: 'metric', label: '运行时长', value: { $: 'data.uptime' }, tone: 'good' },
        { type: 'metric', label: '常驻内存', value: { $: 'data.mem' }, tone: 'info' },
      ],
    },
    {
      type: 'row',
      style: { gap: 'S', columns: 'equal' },
      children: [
        { type: 'metric', label: '界面拉取', value: { $: 'data.pulls' }, caption: '本次运行累计' },
        { type: 'metric', label: '心跳', value: { $: 'data.beats' }, caption: '状态条推送次数' },
      ],
    },
    {
      type: 'chart',
      kind: 'bar',
      categories: { $: 'data.categories' },
      series: [{ name: '拉取次数', values: { $: 'data.series' } }],
      unit: '次',
      caption: '近 12 分钟，手机界面拉取本面板的次数',
    },
  ]

  if (supports('gallery')) {
    children.push({
      type: 'gallery',
      columns: 2,
      aspect: 1.45,
      items: gradientTiles().map(tile => ({ src: tile.src, caption: tile.name, alt: tile.name })),
    })
  }

  children.push(
    {
      type: 'keyValue',
      items: [
        ['主机', { $: 'data.host' }],
        ['Node', process.version],
        ['平台', `${process.platform}/${process.arch}`],
        ['插件', 'local-dash'],
      ],
    },
    { type: 'callout', text: '面板里的每个数字都由运行它的引擎实测，不是模拟数据。', tone: 'info' },
    {
      type: 'actions',
      items: [
        { label: '复制诊断', action: 'copy-diag', icon: 'copy' },
        { label: '刷新', action: 'refresh', icon: 'refresh' },
      ],
    },
  )

  return { v: 2, type: 'stack', accent: 'violet', style: { gap: 'M', padding: 'M' }, children }
}

function panelData(now = Date.now()) {
  return {
    host: os.hostname(),
    uptime: uptimeText(now),
    mem: memText(),
    pulls: state.pulls,
    beats: state.beats,
    categories: state.minutes.map((_, i) => `${(i - state.minutes.length + 1) % 60}m`),
    series: [...state.minutes],
  }
}

export const name = 'local-dash'

export function apply(ctx) {
  ctx.inject(['dshGo'], (ctx) => {
    ctx.dshGo.panel('dash', {
      view: (scope, caps) => panelView(scope, caps),
      data: (scope, emit) => {
        const push = () => {
          mark()
          state.pulls += 1
          emit(panelData())
        }
        push()
        const timer = setInterval(push, 15000)
        timer.unref?.()
        return () => clearInterval(timer)
      },
      actions: {
        'copy-diag': () => ({ copy: diagnostics(), toast: '诊断信息已复制' }),
        refresh: () => ({ refresh: true }),
      },
    })

    ctx.dshGo.strip('pulse', (scope, emit, caps) => {
      const zh = !String(caps?.locale ?? '').startsWith('en')
      const tick = () => {
        mark()
        state.beats += 1
        emit({
          text: zh ? `引擎 ${uptimeText()}` : `up ${uptimeText()}`,
          icon: 'bolt',
          tone: 'good',
        })
      }
      tick()
      const timer = setInterval(tick, 30000)
      timer.unref?.()
      return () => clearInterval(timer)
    })

    ctx.dshGo.turnNote('beat', (scope, emit) => {
      emit({ '本地引擎': { text: `在线 · ${uptimeText()}`, tone: 'good' } })
    })

    ctx.dshGo.on('recap', (scope, event) => {
      const zh = !String(event?.locale ?? '').startsWith('en')
      return {
        insert: zh
          ? '把当前对话压缩成三条要点，每条一句话，只列结论。'
          : 'Compress this conversation into three one-line takeaways.',
      }
    })

    ctx.dshGo.on('keep', (scope, event) => {
      const text = String(scope?.message ?? '').trim()
      if (!text) return { toast: '这条回复是空的，没什么可存的' }
      return { copy: text, toast: '已复制这条回复' }
    })
  })
}
