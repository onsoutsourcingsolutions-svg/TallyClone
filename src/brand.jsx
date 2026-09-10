import { useApp } from './state.jsx';

/* ---------- brand: company logo (or gold monogram) + company name ---------- */
export function initialsOf(name) {
  const parts = String(name || '').split(/\s+/).filter(Boolean);
  let s = '';
  for (const p of parts) {
    const m = p.match(/[A-Za-z0-9&]/);
    if (m && s.length < 2) s += m[0];
  }
  return (s || '◆').toUpperCase();
}

export function CompanyBrand({ company, compact, onClick, title }) {
  const { company: ctxCompany } = useApp();
  const co = company || ctxCompany;
  if (!co) return null;
  const inner = (
    <div className={`brandrow${compact ? ' compact' : ''}`}>
      {co.logo
        ? <img className="clogo" src={`/api/company/logo?v=${encodeURIComponent(co.logo)}`} alt="logo" />
        : <div className="monogram"><span>{initialsOf(co.name)}</span></div>}
      <div className="btext">
        <span className="bname" title={co.name}>{co.name}</span>
        {!compact && co.financial_year_from && (
          <span className="bsub">Books · {co.financial_year_from.slice(0, 4)}–{Number(co.financial_year_from.slice(0, 4)) + 1}</span>
        )}
      </div>
    </div>
  );
  if (!onClick) return inner;
  return (
    <button type="button" className="brandbtn" onClick={onClick} title={title || 'Click to update to the newest build'}>{inner}</button>
  );
}
