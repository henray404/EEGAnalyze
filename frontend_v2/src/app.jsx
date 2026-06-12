/* global React, ReactDOM, Icon, OverviewPage, SingleFilePage, BatchPage, BatchRecoverixPage, MLPage */
const { useState, useEffect } = React;

function Navbar({ page, setPage }) {
  const links = [
    { id: 'overview', label: 'Overview' },
    { id: 'single', label: 'Single File' },
    { id: 'batch', label: 'Batch Analysis' },
    { id: 'batch-recoverix', label: 'Batch recoveriX' },
    { id: 'ml', label: 'Machine Learning' },
  ];
  return (
    <nav className="nav">
      <div className="nav-inner">
        <div className="brand" onClick={() => setPage('overview')}>
          <span className="brand-dot"><Icon.Logo /></span>
          EEG Analysis Tool
        </div>
        <div className="nav-pills">
          {links.map(l => (
            <button key={l.id} className={`nav-pill ${page === l.id ? 'active' : ''}`} onClick={() => setPage(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
        <div className="nav-right">
          <button className="icon-btn-round" title="Settings"><Icon.Settings /></button>
          <button className="icon-btn-round" title="Notifications"><Icon.Bell /><span className="dot-badge" /></button>
          <div className="avatar">DR</div>
        </div>
      </div>
    </nav>
  );
}

function App() {
  const [page, setPage] = useState('overview');
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [page]);
  return (
    <>
      <Navbar page={page} setPage={setPage} />
      {page === 'overview' && <OverviewPage go={setPage} />}
      {page === 'single' && <SingleFilePage />}
      {page === 'batch' && <BatchPage />}
      {page === 'batch-recoverix' && <BatchRecoverixPage />}
      {page === 'ml' && <MLPage />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
