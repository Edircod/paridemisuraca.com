// Scroll reveals for the serious voice: lines rise out of a mask, blocks rise, data decodes.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';

gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin);

const onEnter = (trigger: Element) => ({ trigger, start: 'top 86%', once: true });

gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', () => {
  for (const el of document.querySelectorAll<HTMLElement>('[data-reveal="lines"]')) {
    SplitText.create(el, {
      type: 'lines',
      mask: 'lines',
      autoSplit: true,
      onSplit: (self) =>
        gsap.from(self.lines, { yPercent: 110, duration: 1, ease: 'expo.out', stagger: 0.07, scrollTrigger: onEnter(el) }),
    });
    gsap.set(el, { visibility: 'visible' });
  }

  for (const el of document.querySelectorAll<HTMLElement>('[data-reveal="rise"]')) {
    gsap.fromTo(el, { autoAlpha: 0, y: 28 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: 'expo.out', scrollTrigger: onEnter(el) });
  }

  for (const el of document.querySelectorAll<HTMLElement>('[data-reveal="decode"]')) {
    const text = el.textContent ?? '';
    el.textContent = '';
    gsap.set(el, { visibility: 'visible' });
    gsap.to(el, { duration: 1.2, ease: 'none', scrambleText: { text, chars: '01<>/_#', speed: 0.6 }, scrollTrigger: onEnter(el) });
  }
});
