export default function ScenarioAnalysisPanel({ analysis }) {
  if (!analysis?.length) return null;

  return (
    <div className="section">
      <div className="section-title">Сценарный анализ</div>
      <div className="scenario-analytics">
        {analysis.map((item) => (
          <div key={item.scenario} className="analysis-card">
            <div className="analysis-title">{item.scenario}</div>
            <div className="analysis-detail">{item.key_message}</div>
            <div className="analysis-metric">
              <span>Пропускная</span>
              <strong>{item.projected_throughput} ед/ч</strong>
            </div>
            <div className="analysis-metric">
              <span>Заполненность</span>
              <strong>{item.projected_fill_pct}%</strong>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
