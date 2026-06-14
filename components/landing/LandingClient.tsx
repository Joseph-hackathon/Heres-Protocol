'use client'

import { useEffect } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'

/* ============================================================
   LIVENESS PULSE - the signature motif
   A breathing line that slows and flattens into stillness.
   amplitude is a single state value 0..1 (1 = fully alive).
   ============================================================ */
type PulseOpts = { cycles?: number; tick?: boolean; startAmp?: number }
type PulseController = {
  start: () => void
  stop: () => void
  setVisible: (v: boolean) => void
  drawStatic: (a: number) => void
  setTarget: (a: number) => void
  setSpeed: (s: number) => void
  destroy: () => void
}

function makePulse(canvas: HTMLCanvasElement | null, opts: PulseOpts): PulseController | null {
  if (!canvas) return null
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  let W = 0
  let H = 0
  let raf: number | null = null
  let running = false
  let visible = true
  let t0 = performance.now()
  const accent = '#2DD4E8'

  function resize() {
    const rect = canvas!.getBoundingClientRect()
    W = Math.max(1, rect.width)
    H = Math.max(1, rect.height)
    canvas!.width = Math.round(W * dpr)
    canvas!.height = Math.round(H * dpr)
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  resize()

  let amp = opts.startAmp != null ? opts.startAmp : 1
  let targetAmp = amp
  let speed = 1

  function draw(now: number) {
    raf = null
    const elapsed = (now - t0) / 1000
    amp += (targetAmp - amp) * 0.04

    ctx!.clearRect(0, 0, W, H)
    const midY = H / 2

    ctx!.beginPath()
    ctx!.strokeStyle = 'rgba(234,238,246,0.10)'
    ctx!.lineWidth = 1
    ctx!.moveTo(0, midY)
    ctx!.lineTo(W, midY)
    ctx!.stroke()

    const breathe = 0.65 + 0.35 * Math.sin(elapsed * ((Math.PI * 2) / 4))
    const env = amp * breathe

    ctx!.beginPath()
    ctx!.lineWidth = 1.25
    ctx!.strokeStyle = accent
    ctx!.globalAlpha = 0.42 + 0.5 * amp

    const pts = Math.max(60, Math.floor(W / 2))
    for (let i = 0; i <= pts; i++) {
      const x = (i / pts) * W
      const phase = (i / pts) * Math.PI * (opts.cycles || 6) + elapsed * 1.4 * speed
      const base = Math.sin(phase) * 0.5
      let beat = 0
      const beatPhase = phase % (Math.PI * 2)
      if (beatPhase > Math.PI * 0.92 && beatPhase < Math.PI * 1.08) {
        beat = Math.sin(((beatPhase - Math.PI * 0.92) / (Math.PI * 0.16)) * Math.PI) * 0.9
      }
      const y = midY - (base + beat) * (H * 0.3) * env
      if (i === 0) ctx!.moveTo(x, y)
      else ctx!.lineTo(x, y)
    }
    ctx!.stroke()
    ctx!.globalAlpha = 1

    if (amp > 0.06 && opts.tick) {
      const tx = ((elapsed * 0.12) % 1) * W
      ctx!.beginPath()
      ctx!.fillStyle = accent
      ctx!.globalAlpha = 0.5 * amp
      ctx!.arc(tx, midY, 2.2, 0, Math.PI * 2)
      ctx!.fill()
      ctx!.globalAlpha = 1
    }

    if (running && visible) raf = requestAnimationFrame(draw)
  }

  function start() {
    if (!running) {
      running = true
      t0 = performance.now() - (1 / 60) * 1000
      raf = requestAnimationFrame(draw)
    }
  }
  function stop() {
    running = false
    if (raf) {
      cancelAnimationFrame(raf)
      raf = null
    }
  }
  function setVisible(v: boolean) {
    visible = v
    if (v && running && !raf) raf = requestAnimationFrame(draw)
  }
  function drawStatic(a: number) {
    amp = a
    targetAmp = a
    t0 = performance.now()
    running = false
    ctx!.clearRect(0, 0, W, H)
    const midY = H / 2
    ctx!.beginPath()
    ctx!.strokeStyle = 'rgba(234,238,246,0.10)'
    ctx!.lineWidth = 1
    ctx!.moveTo(0, midY)
    ctx!.lineTo(W, midY)
    ctx!.stroke()
    if (a > 0.05) {
      ctx!.beginPath()
      ctx!.lineWidth = 1.25
      ctx!.strokeStyle = accent
      ctx!.globalAlpha = 0.8
      const pts = Math.max(60, Math.floor(W / 2))
      for (let i = 0; i <= pts; i++) {
        const x = (i / pts) * W
        const phase = (i / pts) * Math.PI * (opts.cycles || 6)
        const y = midY - Math.sin(phase) * 0.5 * (H * 0.3) * a
        if (i === 0) ctx!.moveTo(x, y)
        else ctx!.lineTo(x, y)
      }
      ctx!.stroke()
      ctx!.globalAlpha = 1
    }
  }

  const onResize = () => {
    resize()
    if (!running) drawStatic(amp)
  }
  window.addEventListener('resize', onResize, { passive: true })

  return {
    start,
    stop,
    setVisible,
    drawStatic,
    setTarget: (a: number) => {
      targetAmp = a
    },
    setSpeed: (s: number) => {
      speed = s
    },
    destroy: () => {
      stop()
      window.removeEventListener('resize', onResize)
    },
  }
}

/* ---------- WebGL aurora background (custom raw GLSL shader) ----------
   Returns a teardown on success, or null on failure (caller hides canvas). */
function initAurora(canvas: HTMLCanvasElement, isMobile: boolean): (() => void) | null {
  const gl = (canvas.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: false }) ||
    canvas.getContext('experimental-webgl', { antialias: false, alpha: true })) as WebGLRenderingContext | null
  if (!gl) return null

  const vsSrc = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}'
  const fsSrc = [
    'precision highp float;',
    'uniform vec2 u_res;',
    'uniform float u_time;',
    'uniform vec2 u_mouse;',
    'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float noise(vec2 p){vec2 i=floor(p);vec2 f=fract(p);vec2 u=f*f*(3.0-2.0*f);',
    'return mix(mix(hash(i+vec2(0.0,0.0)),hash(i+vec2(1.0,0.0)),u.x),',
    'mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x),u.y);}',
    'float fbm(vec2 p){float v=0.0;float a=0.5;',
    'for(int i=0;i<5;i++){v+=a*noise(p);p*=2.02;a*=0.5;}return v;}',
    'void main(){',
    'vec2 uv=gl_FragCoord.xy/u_res.xy;',
    'vec2 q=uv;q.x*=u_res.x/u_res.y;',
    'float t=u_time*0.035;',
    'vec2 mo=(u_mouse-0.5)*0.35;',
    'float w=fbm(q*1.6+vec2(t,t*0.6)+mo);',
    'float w2=fbm(q*2.4-vec2(t*0.8,t*0.4)+w*0.8);',
    'float band=smoothstep(0.32,0.92,w*0.65+w2*0.5);',
    'vec3 base=vec3(0.024,0.031,0.059);',
    'vec3 cyan=vec3(0.176,0.831,0.910);',
    'vec3 violet=vec3(0.486,0.420,0.941);',
    'float vmix=smoothstep(0.55,0.95,w2);',
    'vec3 light=mix(cyan,violet,vmix*0.45);',
    'vec3 col=base+light*band*0.42;',
    'float glow=smoothstep(0.85,0.0,distance(uv,vec2(0.82,0.92)));',
    'col+=cyan*glow*0.10;',
    'col*=mix(0.78,1.0,smoothstep(0.0,0.6,uv.y));',
    'float g=hash(gl_FragCoord.xy+u_time)*0.02-0.01;',
    'col+=g;',
    'gl_FragColor=vec4(col,1.0);',
    '}',
  ].join('\n')

  function compile(type: number, src: string): WebGLShader | null {
    const s = gl!.createShader(type)
    if (!s) return null
    gl!.shaderSource(s, src)
    gl!.compileShader(s)
    if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) return null
    return s
  }
  const vs = compile(gl.VERTEX_SHADER, vsSrc)
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc)
  if (!vs || !fs) return null
  const prog = gl.createProgram()
  if (!prog) return null
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null
  gl.useProgram(prog)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'p')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

  const uRes = gl.getUniformLocation(prog, 'u_res')
  const uTime = gl.getUniformLocation(prog, 'u_time')
  const uMouse = gl.getUniformLocation(prog, 'u_mouse')

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  const mouse = { x: 0.78, y: 0.85 }
  const targetMouse = { x: 0.78, y: 0.85 }

  function resize() {
    const w = window.innerWidth
    const h = window.innerHeight
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    gl!.viewport(0, 0, canvas.width, canvas.height)
  }
  resize()
  window.addEventListener('resize', resize, { passive: true })

  const onPointerMove = (e: PointerEvent) => {
    targetMouse.x = e.clientX / window.innerWidth
    targetMouse.y = 1 - e.clientY / window.innerHeight
  }
  if (!isMobile) window.addEventListener('pointermove', onPointerMove, { passive: true })

  const startTime = performance.now()
  let rafId: number | null = null
  let programRunning = false
  let lastFrame = 0
  const frameInterval = isMobile ? 1000 / 30 : 1000 / 60

  function render(now: number) {
    if (!programRunning) {
      rafId = null
      return
    }
    if (now - lastFrame < frameInterval) {
      rafId = requestAnimationFrame(render)
      return
    }
    lastFrame = now
    mouse.x += (targetMouse.x - mouse.x) * 0.05
    mouse.y += (targetMouse.y - mouse.y) * 0.05
    gl!.uniform2f(uRes, canvas.width, canvas.height)
    gl!.uniform1f(uTime, (now - startTime) / 1000)
    gl!.uniform2f(uMouse, mouse.x, mouse.y)
    gl!.drawArrays(gl!.TRIANGLES, 0, 3)
    rafId = requestAnimationFrame(render)
  }
  function start() {
    if (!programRunning) {
      programRunning = true
      lastFrame = 0
      rafId = requestAnimationFrame(render)
    }
  }
  function stop() {
    programRunning = false
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  const onVisibility = () => (document.hidden ? stop() : start())
  document.addEventListener('visibilitychange', onVisibility)

  let fio: IntersectionObserver | null = null
  const footer = document.querySelector('footer')
  if ('IntersectionObserver' in window && footer) {
    fio = new IntersectionObserver(
      (es) => es.forEach((en) => (en.isIntersecting ? stop() : start())),
      { threshold: 0.85 }
    )
    fio.observe(footer)
  }

  canvas.classList.add('is-ready')
  start()

  return () => {
    stop()
    window.removeEventListener('resize', resize)
    window.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('visibilitychange', onVisibility)
    if (fio) fio.disconnect()
    const ext = gl.getExtension('WEBGL_lose_context')
    if (ext) ext.loseContext()
  }
}

/**
 * Drives all landing-page motion: nav scroll state, the WebGL aurora background,
 * the two liveness-pulse canvases, Lenis smooth scroll, GSAP scroll reveals, and
 * the "settle into silence" scrub on the how-it-works pulse. Renders nothing.
 * Everything is gated on prefers-reduced-motion and torn down on unmount.
 */
export function LandingClient() {
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const isMobile = window.matchMedia('(max-width: 760px)').matches
    const lowCore = (navigator.hardwareConcurrency || 8) <= 4
    const root = document.querySelector('.lp')
    if (prefersReduced) root?.classList.add('reduced')

    const cleanups: Array<() => void> = []

    // ---- Nav scrolled state ----
    const nav = document.getElementById('nav')
    const onScrollNav = () => {
      if (window.scrollY > 24) nav?.classList.add('scrolled')
      else nav?.classList.remove('scrolled')
    }
    onScrollNav()
    window.addEventListener('scroll', onScrollNav, { passive: true })
    cleanups.push(() => window.removeEventListener('scroll', onScrollNav))

    // ---- WebGL aurora background (deferred past first paint) ----
    const canvas = document.getElementById('bg-canvas') as HTMLCanvasElement | null
    let auroraTeardown: (() => void) | null = null
    const bootBackground = () => {
      if (prefersReduced || !canvas) return
      if (isMobile && lowCore) return
      try {
        auroraTeardown = initAurora(canvas, isMobile)
      } catch {
        auroraTeardown = null
      }
      if (!auroraTeardown && canvas) canvas.style.display = 'none'
    }
    let idleId: number | null = null
    let bootTimeout: ReturnType<typeof setTimeout> | null = null
    if ('requestIdleCallback' in window) {
      idleId = (window as Window & typeof globalThis).requestIdleCallback(bootBackground, { timeout: 1200 })
    } else {
      bootTimeout = setTimeout(bootBackground, 600)
    }
    cleanups.push(() => {
      if (idleId != null && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleId)
      if (bootTimeout) clearTimeout(bootTimeout)
      if (auroraTeardown) auroraTeardown()
    })

    // ---- Liveness pulses ----
    const heroPulse = makePulse(document.getElementById('heroPulse') as HTMLCanvasElement | null, {
      cycles: 7,
      tick: true,
      startAmp: 1,
    })
    const howPulse = makePulse(document.getElementById('howPulse') as HTMLCanvasElement | null, {
      cycles: 9,
      tick: false,
      startAmp: 1,
    })
    if (heroPulse) cleanups.push(heroPulse.destroy)
    if (howPulse) cleanups.push(howPulse.destroy)

    if (prefersReduced) {
      if (heroPulse) heroPulse.drawStatic(0.85)
      if (howPulse) howPulse.drawStatic(0.0)
    } else {
      if (heroPulse) heroPulse.start()
      if (howPulse) howPulse.start()

      const observePulse = (id: string, pulse: PulseController | null) => {
        const el = document.getElementById(id)
        if (!el || !pulse) return
        const io = new IntersectionObserver(
          (entries) => entries.forEach((e) => pulse.setVisible(e.isIntersecting)),
          { threshold: 0.05 }
        )
        io.observe(el)
        cleanups.push(() => io.disconnect())
      }
      observePulse('heroPulse', heroPulse)
      observePulse('howPulse', howPulse)
    }

    // ---- GSAP reveals + the "settle into silence" scroll choreography ----
    if (!prefersReduced) {
      gsap.registerPlugin(ScrollTrigger)

      let lenis: Lenis | null = null
      let tickerFn: ((time: number) => void) | null = null
      if (!isMobile) {
        lenis = new Lenis({ duration: 1.15, easing: (t: number) => 1 - Math.pow(1 - t, 3), smoothWheel: true })
        lenis.on('scroll', () => ScrollTrigger.update())
        tickerFn = (time: number) => lenis!.raf(time * 1000)
        gsap.ticker.add(tickerFn)
        gsap.ticker.lagSmoothing(0)
      }

      const heroLines = gsap.utils.toArray<HTMLElement>('.hero__title .line > span')
      gsap.set(heroLines, { yPercent: 115 })
      const tl = gsap.timeline({ delay: 0.15 })
      tl.to(heroLines, { yPercent: 0, duration: 1.0, ease: 'power3.out', stagger: 0.12 })

      const triggers: ScrollTrigger[] = []
      gsap.utils.toArray<HTMLElement>('.reveal').forEach((el) => {
        triggers.push(
          ScrollTrigger.create({
            trigger: el,
            start: 'top 88%',
            once: true,
            onEnter: () => el.classList.add('in'),
          })
        )
      })

      const heroReveal = gsap.delayedCall(0.45, () => {
        document.querySelectorAll('.hero .reveal').forEach((el) => el.classList.add('in'))
      })

      if (howPulse) {
        const stateEl = document.getElementById('pulseState')
        triggers.push(
          ScrollTrigger.create({
            trigger: '#howPulse',
            start: 'top 80%',
            end: 'bottom 40%',
            scrub: 0.6,
            onUpdate: (self) => {
              const p = self.progress
              howPulse.setTarget(1 - p)
              howPulse.setSpeed(Math.max(0.12, 1 - p * 0.9))
              if (stateEl) {
                if (p < 0.33) {
                  stateEl.textContent = 'Alive · watching'
                  stateEl.style.color = 'var(--sage)'
                } else if (p < 0.8) {
                  stateEl.textContent = 'Settling into silence'
                  stateEl.style.color = 'var(--terracotta)'
                } else {
                  stateEl.textContent = 'Still · settled'
                  stateEl.style.color = 'var(--ash)'
                }
              }
            },
          })
        )
      }

      const onLoad = () => ScrollTrigger.refresh()
      window.addEventListener('load', onLoad)
      const refreshTimeout = setTimeout(() => ScrollTrigger.refresh(), 600)

      cleanups.push(() => {
        tl.kill()
        heroReveal.kill()
        triggers.forEach((t) => t.kill())
        if (tickerFn) gsap.ticker.remove(tickerFn)
        if (lenis) lenis.destroy()
        window.removeEventListener('load', onLoad)
        clearTimeout(refreshTimeout)
        gsap.killTweensOf(heroLines)
      })
    } else {
      document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'))
      document.querySelectorAll<HTMLElement>('.hero__title .line > span').forEach((s) => {
        s.style.transform = 'none'
      })
    }

    return () => {
      cleanups.forEach((fn) => fn())
    }
  }, [])

  return null
}
