'use client'

import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'

// Aceternity-style "flip words" (https://ui.aceternity.com/components/flip-words):
// the active word's letters blur and stagger in, hold, then the whole word blurs,
// scales and drifts out before the next word swaps in. Only this cyan rules/intent
// lead animates; the rest of the headline is static. Driven by GSAP (the landing's
// existing motion lib). Reduced motion swaps the text with no animation.
const WORDS = ['rules.', 'intent.']
const HOLD_MS = 2000
const NBSP = ' '

export function FlipWord() {
  const [index, setIndex] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const letters = el.querySelectorAll<HTMLElement>('.hero__flip-letter')

    let inTween: gsap.core.Tween | null = null
    let outTween: gsap.core.Tween | null = null
    const next = () => setIndex((i) => (i + 1) % WORDS.length)

    if (!reduce) {
      gsap.set(el, { clearProps: 'transform,filter,opacity' })
      inTween = gsap.fromTo(
        letters,
        { opacity: 0, y: 12, filter: 'blur(8px)' },
        { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.35, stagger: 0.045, ease: 'power3.out' }
      )
    }

    const timer = setTimeout(() => {
      if (reduce) {
        next()
        return
      }
      outTween = gsap.to(el, {
        opacity: 0,
        y: -34,
        x: 30,
        scale: 1.6,
        filter: 'blur(8px)',
        duration: 0.35,
        ease: 'power2.in',
        onComplete: next,
      })
    }, HOLD_MS)

    return () => {
      clearTimeout(timer)
      inTween?.kill()
      outTween?.kill()
    }
  }, [index])

  const word = WORDS[index]
  return (
    <span className="hero__flip" ref={ref}>
      <span className="sr-only">{WORDS.join(' ')}</span>
      <span aria-hidden>
        {word.split('').map((ch, i) => (
          <span className="hero__flip-letter" key={`${index}-${i}`}>
            {ch === ' ' ? NBSP : ch}
          </span>
        ))}
      </span>
    </span>
  )
}
