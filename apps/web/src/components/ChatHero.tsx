import { MERIDIAN, type PinStatus, type Point, type Role } from '@pinthread/shared';
import { Crop } from '../drawing/Crop';
import { DEMO_SHEET, SheetProvider } from '../drawing/sheet';
import { Icon } from '../lib/icons';
import { Avatar, StatusChip } from './ui';

type Who = { initials: string; role: Role; name: string };
const priya: Who = { initials: 'PS', role: 'site', name: 'Priya Shah' };
const marco: Who = { initials: 'MR', role: 'mep', name: 'Marco Ruiz' };
const dana: Who = { initials: 'DO', role: 'struct', name: 'Dana Okafor' };
const ROUTE = MERIDIAN.routes['RFI-001/v1'] as Point[];
const AT = MERIDIAN.pins['RFI-001'].at as Point;

function Msg({ who, role, time, children, mine, i }: { who: Who; role: string; time: string; children: React.ReactNode; mine?: boolean; i: number }) {
  return (
    <div className={`msg ${mine ? 'mine' : ''} ch-in`} style={{ '--i': i } as React.CSSProperties}>
      {!mine && <Avatar p={who} />}
      <div className="body">
        <div className="meta">{mine ? <><span>{time}</span><b>You</b></> : <><b>{who.name}</b><span className="faint">{role}</span><span>{time}</span></>}</div>
        {children}
      </div>
    </div>
  );
}

/**
 * The landing illustration: an issue conversation the way it looks in PinThread. Static, fictional content
 * built from the same components and styles as the real room.
 */
export function ChatHero({ status = 'complete', compact }: { status?: PinStatus; compact?: boolean }) {
  return (
    <SheetProvider sheet={DEMO_SHEET}>
      <div className={`chathero ${compact ? 'compact' : ''}`} aria-label="Example: an RFI discussed and approved in a PinThread thread" role="img">
        <div className="ch-window">
          <div className="ch-head">
            <div className="row"><StatusChip status={status} large /><span className="grow" /><span className="ch-live"><i />Live</span></div>
            <b className="ch-title">SD-3 supply duct clashes with Beam B-14</b>
            <div className="row wrap" style={{ gap: 6 }}><span className="ref">RFI-001 · C-103 Rev B · Grid C–D/4</span><span className="tag sev-high">high</span><span className="tag mep">mep</span></div>
          </div>
          <div className="ch-thread">
            <Msg who={priya} role="Site lead" time="09:12" i={0}>
              <div className="bubble">SD-3 hits the B-14 soffit between C and D. Ceiling close-out is Friday. What route can MEP and Structural both accept?</div>
              <div className="ch-photo"><img src="/field/img_0742.jpg" alt="" loading="lazy" /></div>
            </Msg>
            <Msg who={marco} role="MEP" time="09:40" i={1}>
              <div className="card proposal ch-card">
                <div className="ch"><span className="tag ver">v1</span><b>Proposal</b><span className="faint small">Rev B</span><span className="grow" /><span style={{ color: 'var(--redline)' }}><Icon name="route" size="sm" /></span></div>
                <div className="cb ch-cb">
                  <div className="ch-crop"><Crop at={AT} status={status} route={ROUTE} width={200} aspect={1.35} /></div>
                  <p className="psum">Drop SD-3 150 mm and cross B-14 through web opening WO-2.</p>
                </div>
                <div className="cf"><span className="appr ok"><Avatar p={marco} mark="ok" size="sm" />MEP</span><span className="appr ok"><Avatar p={dana} mark="ok" size="sm" />Structural</span></div>
              </div>
            </Msg>
            <Msg who={dana} role="Structural" time="10:02" i={2}>
              <div className="bubble">Does the dashed line keep 50 mm clear of the bottom flange?</div>
            </Msg>
            <Msg who={marco} role="MEP" time="10:04" i={3}>
              <div className="bubble"><span className="quote">Dana: Does the dashed line keep 50 mm clear…</span>Yes. 65 mm to the flange, and the opening is already sleeved.</div>
            </Msg>
            <div className="ch-in sys-decision" style={{ '--i': 4 } as React.CSSProperties}>
              <span className="okdot"><Icon name="check" size="sm" /></span>
              <span><b>Review complete.</b> MEP and Structural approved v1 on Rev B. The pin is green on every drawing.</span>
            </div>
          </div>
          <div className="ch-composer"><span className="ch-input">Message RFI-001…</span><span className="tool lbl"><Icon name="route" size="sm" />Proposal</span><span className="send"><Icon name="send" size="sm" /></span></div>
        </div>
        {!compact && (
          <div className="ch-push" aria-hidden>
            <span className="ch-push-app"><Icon name="pin" size="sm" /></span>
            <div className="grow"><div className="row"><b>RFI-001 is green</b><span className="grow" /><span className="faint small">now</span></div><span className="small">Dana Okafor approved proposal v1. Review complete on C-103 Rev B.</span></div>
          </div>
        )}
      </div>
    </SheetProvider>
  );
}
