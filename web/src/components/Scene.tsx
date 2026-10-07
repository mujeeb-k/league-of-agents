// Canvas content: folder frames, file tiles, code cards, wires, import edges, selection.
// Renders the scene that computeScene() in lib/scene.ts builds.
import { Fragment, useLayoutEffect } from 'react';
import { CH, CW } from '../lib/constants';
import type { Token } from '../lib/highlight';
import { plural } from '../lib/util';
import { scene, updateEdgeFocus, type CardData, type FrameData, type SelBox, type TileData } from '../lib/scene';
import { fitLabels } from '../lib/labels';
import { dom } from '../state/app';
import { useRegion } from '../state/render';
import { Stat } from './bits';
import { FileIcon } from './FileIcon';

const box = (x: number, y: number, w: number, h: number) => ({
  left: `${x}px`,
  top: `${y}px`,
  width: `${w}px`,
  height: `${h}px`,
});

/** A file zoomed out: its name on one line, and its changed rows marked. */
function Tile({ f }: { f: TileData }) {
  return (
    <div className={f.cls} data-path={f.path} style={box(f.x, f.y, CW, CH)}>
      <span className="n">
        <FileIcon kind={f.kind} />
        {f.name}
      </span>
      {f.ticks.length ? (
        <span className="tk">
          {f.ticks.map(t => (
            <i key={t.k + t.row} className={t.k} style={{ '--row': t.row } as React.CSSProperties} />
          ))}
        </span>
      ) : null}
    </div>
  );
}

function Frame({ f }: { f: FrameData }) {
  const style: React.CSSProperties & Record<string, string> = box(f.x, f.y, f.w, f.h);
  if (f.hotc) style['--hotc'] = f.hotc;
  return (
    <div className={f.cls} data-dir={f.path} style={style}>
      <div className="flabel">
        <b>
          <FileIcon kind="folder" />
          {f.name + '/'}
        </b>
        {f.count ? <span className="cnt">{plural(f.count, 'file')}</span> : null}
        {f.note ? <span>{f.note}</span> : null}
        {f.stat ? <Stat a={f.stat.a} d={f.stat.d} /> : null}
      </div>
    </div>
  );
}

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

function Card({ c }: { c: CardData }) {
  if (c.ghost)
    return (
      <div className="card ghost" data-path={c.path} style={box(c.x, c.y, CW, CH)}>
        {c.name}
        <br />
        is created in this run
      </div>
    );
  return (
    <div className={c.cls} data-path={c.path} style={box(c.x, c.y, CW, CH)}>
      <header>
        <span className="fn">{c.name}</span>
        {c.stat ? <Stat a={c.stat.a} d={c.stat.d} /> : null}
      </header>
      <div className="code">
        {c.above ? <div className="more">{`${plural(c.above, 'line')} above`}</div> : null}
        {c.rows.map(r => (
          <div key={r.id} ref={markFresh} className={`ln ${r.k}`}>
            <i>{r.gutter}</i>
            <span>
              <Code tokens={r.tokens} />
            </span>
          </div>
        ))}
        {c.rest > 0 ? <div className="more">{plural(c.rest, 'more line')}</div> : null}
        {c.empty ? <div className="more">Empty file</div> : null}
      </div>
      {c.imports || c.usedBy ? (
        <div className="uses">
          {[c.imports ? `imports ${c.imports}` : '', c.usedBy ? `used by ${c.usedBy}` : ''].filter(Boolean).join(' · ')}
        </div>
      ) : null}
    </div>
  );
}

const Sel = ({ s }: { s: SelBox }) => (
  <div className={s.file ? 'selbox f' : 'selbox'} style={box(s.x, s.y, s.w, s.h)}>
    <i />
    <i />
    <i />
    <i />
    <b>{s.label}</b>
  </div>
);

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
        {sc?.tiles.map(f => (
          <Tile key={'t:' + f.path} f={f} />
        ))}
        {sc?.cards.map(c => (
          <Card key={c.path} c={c} />
        ))}
      </>
    ),
    sels: sc?.sels.map((s, i) => <Sel key={i} s={s} />),
  };
}
