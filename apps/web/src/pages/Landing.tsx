import { useEffect } from 'react';
import { Link } from 'wouter';
import { ChatHero } from '../components/ChatHero';
import { useAccount } from '../lib/account';
import { Icon, Logo } from '../lib/icons';

export function MarketingNav() {
  const { data: account } = useAccount();
  return (
    <nav className="lnav">
      <Link href="/" className="logo" style={{ fontSize: 18, textDecoration: 'none' }}><Logo size={26} />PinThread</Link>
      <span className="grow" />
      <a className="hide-sm" href="/#how">How it works</a>
      <Link className="hide-sm" href="/demo">Live demo</Link>
      <a className="hide-sm" href="https://github.com/miwas1/pinthread" target="_blank" rel="noreferrer">GitHub</a>
      {account
        ? <Link href="/app" className="btn btn-ink">Open PinThread<Icon name="chevron" size="sm" /></Link>
        : <><Link href="/login" className="lnav-login">Log in</Link><Link href="/signup" className="btn btn-ink">Get started</Link></>}
    </nav>
  );
}

const STEPS: [string, string, string][] = [
  ['01', 'Upload your drawings', 'Drop in a PDF set or plan images. Each sheet keeps its number and revision.'],
  ['02', 'Pin the question', 'Click the clash, write the question, choose who has to sign off.'],
  ['03', 'Talk it through', 'A private chat for that pin: photos, replies, and redlined proposals.'],
  ['04', 'Sign off and hand over', 'Approvals count only on the current revision. Export the register as a PDF.'],
];

const FEATURES: [string, string, React.ReactNode][] = [
  ['One thread per clash', 'Every pin opens its own conversation with only the people who need to be in it. No more hunting through email chains for the reply about Beam B-14.', <Icon name="pin" />],
  ['Decisions that track the revision', 'A sign-off is tied to the proposal version and the drawing revision. Upload Rev C and affected reviews reopen automatically.', <Icon name="layers" />],
  ['Everyone sees the same status', 'Pins turn amber, red or green on every screen the moment someone acts. Reviewers get a Jump to pin alert when it is their turn.', <Icon name="bell" />],
  ['A register that matches', 'Export an RFI register PDF built from the same record as the drawing and the thread, with a hash on every entry.', <Icon name="file" />],
];

export function Landing() {
  const { data: account } = useAccount();
  useEffect(() => { document.title = 'PinThread · Drawing questions, answered on the drawing'; }, []);
  return (
    <div className="landing">
      <MarketingNav />
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">For site leads, engineers and MEP coordinators</span>
          <h1>Drawing questions, answered <em>on the drawing.</em></h1>
          <p className="lead">Drop a pin where the clash is. The right reviewers get the crop, the proposed fix and the question in one chat thread. The pin turns green on everyone's drawing when the last one signs off.</p>
          <div className="cta">
            {account
              ? <Link href="/app" className="btn btn-ink xl">Go to your projects<Icon name="chevron" size="sm" /></Link>
              : <Link href="/signup" className="btn btn-ink xl">Create your account<Icon name="chevron" size="sm" /></Link>}
            <Link href="/demo" className="btn btn-outline xl">Try the live demo</Link>
          </div>
          <p className="faint note-line">
            {account ? <>Signed in as {account.name}.</> : <>Already using PinThread? <Link href="/login">Log in</Link></>}
          </p>
        </div>
        <ChatHero />
      </section>

      <section className="lsec" id="how">
        <h2 className="lsec-h">How it works</h2>
        <div className="steps4">
          {STEPS.map(([k, t, d]) => <div className="s4" key={k}><span className="k">{k}</span><b>{t}</b><span>{d}</span></div>)}
        </div>
      </section>

      <section className="lsec">
        <div className="feat-grid">
          {FEATURES.map(([t, d, ico]) => <div className="feat" key={t}><span className="feat-ico">{ico}</span><b>{t}</b><p>{d}</p></div>)}
        </div>
      </section>

      <section className="lsec">
        <div className="cta-band">
          <div className="grow">
            <h2>Bring your next RFI to PinThread</h2>
            <p>Create a project, upload a sheet and invite your consultants with a link. Messages run on Nexconn Chat, so the thread is live on every device.</p>
          </div>
          <div className="row wrap" style={{ gap: 10 }}>
            <Link href={account ? '/app/new' : '/signup'} className="btn btn-ink lg">{account ? 'New project' : 'Create your account'}</Link>
            <Link href="/demo" className="btn btn-outline lg">See the demo first</Link>
          </div>
        </div>
      </section>

      <footer className="lfoot">
        <span>PinThread · Real-time messaging by the Nexconn Chat SDK.</span>
        <span className="grow" />
        <Link href="/demo">Demo</Link>
        <a href="https://github.com/miwas1/pinthread" target="_blank" rel="noreferrer">Source</a>
      </footer>
    </div>
  );
}
