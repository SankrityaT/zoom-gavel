import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger, useGSAP)

// One timing system for the whole page; marketing.css mirrors it.
export const DUR = { s: 0.4, m: 0.8, l: 1.2 }
export const STAGGER = 0.07
export const EASE_OUT = 'power3.out'
export const MOTION_OK = '(prefers-reduced-motion: no-preference)'
export const DESKTOP = '(min-width: 960px)'

export { gsap, ScrollTrigger, useGSAP }
