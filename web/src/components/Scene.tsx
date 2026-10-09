// Canvas content: folder frames, file tiles, code cards, wires, import edges, selection.
// Renders the scene that computeScene() in lib/scene.ts builds.
import { Fragment, memo, useEffect, useLayoutEffect } from 'react';
import { CH, CW } from '../lib/constants';
import type { Token } from '../lib/highlight';
import { t, tn } from '../i18n';
import type { Author } from '../lib/attribution';
import { cn } from '@/lib/utils';
import {
  scene,
  updateEdgeFocus,
  type CardData,
  type FrameData,
  type SelBox,
  type TileData,
  type ZoneBox,
} from '../lib/scene';
import { fitLabels } from '../lib/labels';
import { culling, drawn } from '../lib/cull';
import { wantHeads } from '../api/live';
import { dom, st } from '../state/app';
import { useRegion } from '../state/render';
import { Stat } from './bits';
import { FileIcon } from './FileIcon';

const box = (x: number, y: number, w: number, h: number) => ({
  left: `${x}px`,
  top: `${y}px`,
  width: `${w}px`,
  height: `${h}px`,
});

/** Coloured by author, zoomed out: a bar along a tile's foot, split by who wrote its lines; unknown is left empty. */
const Share = ({ s }: { s: Record<Author, number> }) => {
  const total = s.agent + s.human + s.mixed + s.unknown;
  if (!total) return null;
  return (
    <span className="au">
      {(['agent', 'mixed', 'human'] as const).map(a =>
        s[a] ? <i key={a} className={`au-${a}`} style={{ width: `${(100 * s[a]) / total}%` }} /> : null,
      )}
    </span>
  );
};

/** A file zoomed out: its name on one line, and its changed rows marked. */
const Tile = memo(function Tile({ f }: { f: TileData }) {
  return (
    <div className={f.sel ? f.cls + ' sel' : f.cls} data-path={f.path} style={box(f.x, f.y, CW, CH)}>
      <span className="n">
        <FileIcon kind={f.kind} />
        {f.name}
      </span>
      {f.share ? <Share s={f.share} /> : null}
      {f.ticks.length ? (
        <span className="tk">
          {f.ticks.map(t => (
            <i key={t.k + t.row} className={t.k} style={{ '--row': t.row } as React.CSSProperties} />
          ))}
        </span>
      ) : null}
    </div>
  );
});

const Frame = memo(function Frame({ f }: { f: FrameData }) {
  const style: React.CSSProperties & Record<string, string> = box(f.x, f.y, f.w, f.h);
  if (f.hotc) style['--hotc'] = f.hotc;
  return (
    <div className={f.sel ? f.cls + ' sel' : f.cls} data-dir={f.path} style={style}>
      <div className="flabel">
        <b>
          <FileIcon kind="folder" />
          {f.name + '/'}
        </b>
        {f.count ? <span className="cnt">{tn(f.count, '{n} file', '{n} files')}</span> : null}
        {f.note ? <span>{f.note}</span> : null}
        {f.stat ? <Stat a={f.stat.a} d={f.stat.d} /> : null}
      </div>
    </div>
  );
});

/** A line that appears because the view switched (actions.ts setMode) fades in; other new lines just appear. */
const markFresh = (el: HTMLDivElement | null) => {
  if (el && dom.world.dataset.switching !== undefined) el.classList.add('fresh');
};

const Code = ({ tokens }: { tokens: Token[] }) => (
  <>
    {tokens.map((t, i) => {
      const text = t.w ? <mark className="wd">{t.t}</mark> : t.t;
      return t.c ? (
        <em key={i} className={t.c}>
          {text}
        </em>
      ) : (
        <Fragment key={i}>{text}</Fragment>
      );
    })}
  </>
);

const Card = memo(function Card({ c }: { c: CardData }) {
  if (c.ghost)
    return (
      <div className="card ghost" data-path={c.path} style={box(c.x, c.y, CW, CH)}>
        {c.name}
        <br />
        {t('is created in this run')}
      </div>
    );
  return (
    <div className={c.cls} data-path={c.path} style={box(c.x, c.y, CW, CH)}>
      <header>
        <span className="fn">{c.name}</span>
        {c.from ? <span className="from">{t('renamed from {name}', { name: c.from })}</span> : null}
        {c.at !== null ? <span className="at">{t('At step {n}', { n: c.at + 1 })}</span> : null}
        {c.stat ? <Stat a={c.stat.a} d={c.stat.d} /> : null}
      </header>
      <div className="code">
        {c.above ? <div className="more">{tn(c.above, '{n} line above', '{n} lines above')}</div> : null}
        {c.rows.map(r => (
          <div
            key={r.id}
            ref={markFresh}
            className={r.au ? `ln ${r.k} au-${r.au}` : `ln ${r.k}`}
            data-ln={r.ln ?? undefined}
          >
            <i>{r.gutter}</i>
            <span>
              <Code tokens={r.tokens} />
            </span>
          </div>
        ))}
        {c.rest > 0 ? <div className="more">{tn(c.rest, '{n} more line', '{n} more lines')}</div> : null}
        {c.empty ? <div className="more">{t('Empty file')}</div> : null}
        {c.loading ? <div className="more">{t('Loading…')}</div> : null}
      </div>
      {c.imports || c.usedBy ? (
        <div className="uses">
          {[c.imports ? t('imports {n}', { n: c.imports }) : '', c.usedBy ? t('used by {n}', { n: c.usedBy }) : '']
            .filter(Boolean)
            .join(' · ')}
        </div>
      ) : null}
    </div>
  );
});

const Sel = ({ s }: { s: SelBox }) => (
  <div className={s.file ? 'selbox f' : 'selbox'} style={box(s.x, s.y, s.w, s.h)}>
    <i />
    <i />
    <i />
    <i />
    <b>{s.label}</b>
  </div>
);

/** A session's section, outlined in its colour. */
const Zone = ({ z }: { z: ZoneBox }) => (
  <div
    className={cn('zone', z.file && 'f', z.ended && 'ended')}
    data-run={z.run}
    style={{ ...box(z.x, z.y, z.w, z.h), '--zone': z.colour } as React.CSSProperties}
  >
    {z.label ? <b>{z.label}</b> : null}
  </div>
);

/**
 * The file tiles and code cards: all of them, or on a large map, those near the view, tiles zoomed out and cards
 * zoomed in (lib/cull.ts).
 */
function Files() {
  useRegion('cards');
  const sc = scene;
  if (!sc) return null;
  if (!culling())
    return (
      <>
        {sc.tiles.map(f => (
          <Tile key={'t:' + f.path} f={f} />
        ))}
        {sc.cards.map(c => (
          <Card key={c.path} c={c} />
        ))}
      </>
    );
  if (!st.near) return sc.tiles.filter(f => drawn(f, CW, CH)).map(f => <Tile key={'t:' + f.path} f={f} />);
  return <CardsInView cards={sc.cards.filter(c => drawn(c, CW, CH))} />;
}

/** The cards near the view, which ask for the lines of those still without them (a large map carries none). */
function CardsInView({ cards }: { cards: CardData[] }) {
  useEffect(() => wantHeads(cards.flatMap(c => (!c.ghost && c.loading ? [c.path] : []))));
  return cards.map(c => <Card key={c.path} c={c} />);
}

/**
 * Content of #wires, #nodes, #links and #sels. Elements are keyed by what they show (folder, file, import),
 * so a render updates them in place: switching views or selecting does not rebuild or re-fade the canvas.
 */
export function useScene() {
  const rev = useRegion('scene');
  useLayoutEffect(() => {
    updateEdgeFocus(dom.links);
    fitLabels();
  }, [rev]);
  const sc = scene;
  return {
    wires: sc?.wires.map((w, i) => (
      <path
        key={i}
        className={`wire${w.hot ? ' hot' : ''}`}
        style={w.color ? { stroke: w.color } : undefined}
        d={w.d}
      />
    )),
    nodes: (
      <>
        {sc?.frames.map(f => (
          <Frame key={'d:' + f.path} f={f} />
        ))}
        <Files />
      </>
    ),
    sels: (
      <>
        {sc?.zones.map((z, i) => (
          <Zone key={`${z.run}:${i}`} z={z} />
        ))}
        {sc?.sels.map((s, i) => (
          <Sel key={i} s={s} />
        ))}
      </>
    ),
  };
}
