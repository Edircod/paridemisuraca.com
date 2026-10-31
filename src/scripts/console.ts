// The little shell in the Console section: real commands, history, tab completion and a few toys.
import type { copy } from '../i18n/copy';

export interface ConsoleSetup {
  copy: (typeof copy)['it']['console'];
  lang: 'it' | 'en';
  email: string;
  stack: string[];
  commands: Record<string, string[]>;
  folders: string[];
}

type Kind = 'res' | 'echo' | 'err';

export function mountConsole(root: HTMLElement, setup: ConsoleSetup, onStack: () => void) {
  const { copy: t, lang, commands, folders } = setup;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const term = root.querySelector<HTMLElement>('[data-term]')!;
  const out = root.querySelector<HTMLElement>('[data-out]')!;
  const form = root.querySelector<HTMLFormElement>('[data-console-form]')!;
  const input = form.querySelector('input')!;
  const history: string[] = [];
  let cursor = 0;
  // Output is queued so lines arrive one after another, like a real terminal.
  let queue = Promise.resolve();

  const local = (id: string) => commands[id][lang === 'it' || commands[id].length === 1 ? 0 : 1];
  const fill = (s: string) => s.replace('{n}', String(setup.stack.length)).replace('{email}', setup.email);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));

  const print = (text: string, kind: Kind = 'res', typed = false) => {
    queue = queue.then(async () => {
      const p = document.createElement('p');
      p.className = kind;
      out.append(p);
      if (typed && !reduced) {
        for (const ch of text) {
          p.textContent += ch;
          out.scrollTop = out.scrollHeight;
          await wait(14);
        }
      } else {
        p.textContent = text;
      }
      out.scrollTop = out.scrollHeight;
      await wait(70);
    });
    return queue;
  };

  const echo = (cmd: string) => {
    const p = document.createElement('p');
    p.className = 'echo';
    const b = document.createElement('b');
    b.textContent = '$ ';
    p.append(b, cmd);
    queue = queue.then(() => {
      out.append(p);
      out.scrollTop = out.scrollHeight;
    });
  };

  const flash = (cls: string, ms: number) => {
    if (reduced) return;
    term.classList.remove(cls);
    void term.offsetWidth;
    term.classList.add(cls);
    setTimeout(() => term.classList.remove(cls), ms);
  };

  const goTo = (id: string, block: ScrollLogicalPosition = 'start') =>
    document.getElementById(id)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block });
  // After its lines, a command takes you to the part of the site it talks about.
  const follow = (id: string, block?: ScrollLogicalPosition) => queue.then(() => wait(600)).then(() => goTo(id, block));

  const run = (raw: string) => {
    const line = raw.trim();
    if (!line) return;
    history.push(line);
    cursor = history.length;
    echo(line);
    const [name, ...args] = line.toLowerCase().split(/\s+/);

    if (name === 'cd') {
      const target = (args[0] ?? '').replace(/^\.?\//, '').replace(/\/$/, '');
      if (folders.includes(target)) {
        print(`→ /${target}`);
        queue.then(() => goTo(target));
      } else {
        print(t.out.cdMissing.replace('{x}', args[0] ?? ''), 'err');
      }
      return;
    }

    const id = Object.keys(commands).find((k) => commands[k].includes(name));
    switch (id) {
      case 'help':
        for (const [key, desc] of Object.entries(t.help)) print(`${(key === 'cd' ? 'cd' : local(key)).padEnd(10)} ${desc}`);
        break;
      case 'whoami':
      case 'services':
      case 'sudo':
        for (const l of t.out[id]) print(l);
        if (id === 'whoami') follow('chi-sono');
        if (id === 'services') follow('cosa-costruisco');
        break;
      case 'stack':
        for (const l of t.out.stack) print(fill(l));
        queue.then(onStack);
        break;
      case 'surf':
        t.out.surf.forEach((l, i) => {
          print(l, 'res', i === 1);
          if (i === 1) queue.then(() => flash('swell', 1300));
        });
        follow('surf', 'center');
        break;
      case 'music':
        queue.then(() => flash('loud', 700));
        for (const l of t.out.music) print(l);
        print('▮▮▮▮▮▮▮▮▮▮▮');
        follow('musica', 'center');
        break;
      case 'contact':
        for (const l of t.out.contact) print(fill(l));
        follow('contatti');
        break;
      case 'ls':
        print(folders.map((f) => `${f}/`).join('  '));
        break;
      case 'clear':
        queue = queue.then(() => {
          out.replaceChildren();
        });
        break;
      default:
        print(t.out.notFound.replace('{x}', name), 'err');
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    run(input.value);
    input.value = '';
  });

  const names = [...Object.keys(commands).map(local), 'cd', ...folders.map((f) => `cd ${f}`)];
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!history.length) return;
      e.preventDefault();
      cursor = Math.max(0, Math.min(history.length, cursor + (e.key === 'ArrowUp' ? -1 : 1)));
      input.value = history[cursor] ?? '';
    } else if (e.key === 'Tab' && input.value) {
      const match = names.find((n) => n.startsWith(input.value.toLowerCase()));
      if (!match) return;
      e.preventDefault();
      input.value = match;
    }
  });

  term.addEventListener('click', () => {
    if (!getSelection()?.toString()) input.focus({ preventScroll: true });
  });

  for (const chip of root.querySelectorAll<HTMLButtonElement>('[data-run]')) {
    chip.addEventListener('click', async () => {
      const cmd = chip.dataset.run!;
      input.value = '';
      for (const ch of cmd) {
        input.value += ch;
        await wait(28);
      }
      run(cmd);
      input.value = '';
    });
  }

  const io = new IntersectionObserver(
    ([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      for (const l of t.boot) print(l, 'res', true);
    },
    { threshold: 0.4 },
  );
  io.observe(term);
}
