import { writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AnalysisResult } from '../types.js';

declare const __VERSION__: string;

function escape(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function countNonZeroTypes(types: AnalysisResult['types']): number {
    return Object.values(types).filter((v) => v > 0).length;
}

function typeChartData(types: AnalysisResult['types']): { labels: string[]; data: number[] } {
    const mapping: Record<keyof typeof types, string> = {
        code: '🧑‍💻 Code',
        images: '📷 Images',
        documents: '📄 Documents',
        videos: '🎬 Videos',
        audio: '🎵 Audio',
        archives: '🗃️ Archives',
        other: '❓ Other',
    };
    const labels: string[] = [];
    const data: number[] = [];
    for (const [k, v] of Object.entries(types)) {
        if (v > 0) {
            labels.push(mapping[k as keyof typeof types]);
            data.push(v);
        }
    }
    return { labels, data };
}

function largestFilesChartData(files: AnalysisResult['topLargestFiles']): { labels: string[]; data: number[] } {
    if (!files?.length) return { labels: [], data: [] };
    return {
        labels: files.map((f) => {
            const name = f.path.split(/[/\\]/).pop() ?? f.path;
            return name.length > 20 ? name.slice(0, 17) + '…' : name;
        }),
        data: files.map((f) => f.size),
    };
}

function generateHTML(result: AnalysisResult): string {
    const typeData = typeChartData(result.types);
    const largestData = largestFilesChartData(result.topLargestFiles);
    const version = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '2.0.0';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Directory Analysis — ${escape(result.path)}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Fira Code', 'Consolas', 'Monaco', monospace; color: #00ff00; background: #0a0a0a;
               background-image: linear-gradient(90deg, rgba(0,255,0,.03) 1px, transparent 1px),
                                  linear-gradient(rgba(0,255,0,.03) 1px, transparent 1px);
               background-size: 20px 20px; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { background: #1a1a1a; padding: 30px; border: 2px solid #00ff00;
                  border-radius: 8px; box-shadow: 0 0 20px rgba(0,255,0,.3); margin-bottom: 30px; text-align: center; position: relative; }
        .header::before { content: '> '; position: absolute; left: 15px; top: 15px; color: #00ff00; font-weight: bold; }
        .header h1 { font-size: 2.5em; margin-bottom: 10px; color: #00ff00; text-shadow: 0 0 10px rgba(0,255,0,.5); }
        .path { font-size: 1.1em; color: #00cccc; margin-bottom: 4px; word-break: break-all; }
        .timestamp { color: #666; font-size: 0.9em; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .card { background: #1a1a1a; padding: 25px; border: 1px solid #333; border-radius: 8px;
                box-shadow: 0 0 15px rgba(0,255,0,.1); display: flex; align-items: center;
                transition: all .3s; position: relative; }
        .card::before { content: '$ '; position: absolute; left: 10px; top: 10px; color: #00ff00; font-size: .9em; }
        .card:hover { border-color: #00ff00; box-shadow: 0 0 25px rgba(0,255,0,.3); transform: translateY(-2px); }
        .card-icon { font-size: 2.5em; margin-right: 15px; filter: grayscale(1) brightness(1.5); }
        .card-label { color: #00cccc; font-size: .85em; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
        .card-value { font-size: 1.8em; font-weight: bold; color: #00ff00; text-shadow: 0 0 5px rgba(0,255,0,.5); }
        .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 30px; margin-bottom: 30px; }
        .section { background: #1a1a1a; padding: 25px; border: 1px solid #333; border-radius: 8px;
                   box-shadow: 0 0 15px rgba(0,255,0,.1); margin-bottom: 30px; position: relative; }
        .section::before { content: '>> '; position: absolute; left: 10px; top: 10px; color: #00ff00; font-size: .9em; }
        .section h2 { margin-bottom: 20px; color: #00ff00; border-bottom: 2px solid #00ff00;
                      padding-bottom: 10px; text-transform: uppercase; letter-spacing: 1px; }
        .chart-wrap { position: relative; height: 300px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #333; }
        th { background: #0d0d0d; color: #00cccc; text-transform: uppercase; letter-spacing: 1px; font-size: .85em; }
        tr:hover { background: #2a2a2a; }
        .mono { font-family: 'Fira Code', monospace; font-size: .9em; color: #00ff00; word-break: break-all; }
        .size { color: #ff6b6b; font-weight: bold; }
        .date { color: #666; }
        .dup-group { border: 1px solid #333; border-radius: 4px; margin-bottom: 15px; padding: 15px; background: #0d0d0d; }
        .dup-group h4 { color: #00cccc; margin-bottom: 8px; }
        .dup-list { list-style: none; }
        .dup-list li { padding: 3px 0; font-size: .9em; color: #00ff00; }
        .dup-list li::before { content: '  – '; color: #666; }
        .more { color: #666; font-style: italic; }
        footer { text-align: center; padding: 20px; color: #666; font-size: .9em; border-top: 1px solid #333; margin-top: 30px; }
        footer::before { content: '~$ '; color: #00ff00; }
        @media (max-width: 768px) {
            .container { padding: 10px; }
            .header h1 { font-size: 1.8em; }
            .summary-grid, .charts { grid-template-columns: 1fr; }
            .card { flex-direction: column; text-align: center; }
            .card-icon { margin-right: 0; margin-bottom: 10px; }
        }
    </style>
</head>
<body>
<div class="container">
    <header class="header">
        <h1>📂 Directory Analysis Report</h1>
        <p class="path">📍 ${escape(result.path)}</p>
        <p class="timestamp">📅 Generated ${new Date().toLocaleString()}</p>
    </header>

    <div class="summary-grid">
        <div class="card">
            <div class="card-icon">📦</div>
            <div><div class="card-label">Total Size</div><div class="card-value">${escape(result.totalSizeFormatted)}</div></div>
        </div>
        <div class="card">
            <div class="card-icon">📄</div>
            <div><div class="card-label">Files</div><div class="card-value">${result.files.toLocaleString()}</div></div>
        </div>
        <div class="card">
            <div class="card-icon">📁</div>
            <div><div class="card-label">Folders</div><div class="card-value">${result.folders.toLocaleString()}</div></div>
        </div>
        <div class="card">
            <div class="card-icon">🗂️</div>
            <div><div class="card-label">File Types</div><div class="card-value">${countNonZeroTypes(result.types)}</div></div>
        </div>
    </div>

    <div class="charts">
        <div class="section">
            <h2>📊 File Type Distribution</h2>
            <div class="chart-wrap"><canvas id="typeChart"></canvas></div>
        </div>
        ${result.topLargestFiles?.length ? `
        <div class="section">
            <h2>📈 Largest Files</h2>
            <div class="chart-wrap"><canvas id="largestChart"></canvas></div>
        </div>` : ''}
    </div>

    ${result.largeFiles?.length ? `
    <div class="section">
        <h2>🚨 Large Files</h2>
        <div style="overflow-x:auto">
        <table>
            <thead><tr><th>File Path</th><th>Size</th></tr></thead>
            <tbody>
                ${result.largeFiles.slice(0, 50).map((f) => `
                <tr>
                    <td class="mono">${escape(f.path)}</td>
                    <td class="size">${escape(f.sizeFormatted)}</td>
                </tr>`).join('')}
            </tbody>
        </table>
        </div>
    </div>` : ''}

    ${result.duplicateGroups?.length ? `
    <div class="section">
        <h2>🔄 Duplicate Files</h2>
        <p style="margin-bottom:15px">
            Groups: <strong>${result.duplicateGroups.length}</strong>
            ${result.duplicateStats ? ` &nbsp;|&nbsp; Wasted: <strong style="color:#ff6b6b">${escape(result.duplicateStats.wastedSpaceFormatted)}</strong>` : ''}
        </p>
        ${result.duplicateGroups.slice(0, 10).map((group, i) => `
        <div class="dup-group">
            <h4>Group ${i + 1} — ${escape(group.sizeFormatted)} each × ${group.files.length} files</h4>
            <ul class="dup-list">
                ${group.files.slice(0, 5).map((f) => `<li class="mono">${escape(f)}</li>`).join('')}
                ${group.files.length > 5 ? `<li class="more">… and ${group.files.length - 5} more</li>` : ''}
            </ul>
        </div>`).join('')}
    </div>` : ''}

    ${result.emptyFiles?.length ? `
    <div class="section">
        <h2>📭 Empty Files</h2>
        <div style="overflow-x:auto">
        <table>
            <thead><tr><th>File Path</th><th>Modified</th></tr></thead>
            <tbody>
                ${result.emptyFiles.slice(0, 50).map((f) => `
                <tr>
                    <td class="mono">${escape(f.path)}</td>
                    <td class="date">${f.mtime.toLocaleDateString()}</td>
                </tr>`).join('')}
            </tbody>
        </table>
        </div>
    </div>` : ''}

    <footer>Generated by dir-analysis-tool v${escape(version)}</footer>
</div>

<script>
(function() {
    const COLORS = ['#00ff00','#00cccc','#ffff00','#ff6b6b','#9966ff','#ff9900','#66ff66','#ff3366'];
    const CHART_DEFAULTS = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { labels: { color: '#00ff00', font: { family: 'Fira Code, monospace', size: 12 } } },
            tooltip: {
                backgroundColor: '#1a1a1a', titleColor: '#00ff00', bodyColor: '#00cccc',
                borderColor: '#333', borderWidth: 1,
                titleFont: { family: 'Fira Code, monospace' }, bodyFont: { family: 'Fira Code, monospace' },
            }
        }
    };

    const typeCtx = document.getElementById('typeChart');
    if (typeCtx) {
        new Chart(typeCtx, {
            type: 'doughnut',
            data: {
                labels: ${JSON.stringify(typeData.labels)},
                datasets: [{ data: ${JSON.stringify(typeData.data)}, backgroundColor: COLORS, borderColor: '#0a0a0a', borderWidth: 2 }]
            },
            options: { ...CHART_DEFAULTS, plugins: { ...CHART_DEFAULTS.plugins, legend: { ...CHART_DEFAULTS.plugins.legend, position: 'bottom' } } }
        });
    }

    ${largestData.labels.length ? `
    const largestCtx = document.getElementById('largestChart');
    if (largestCtx) {
        new Chart(largestCtx, {
            type: 'bar',
            data: {
                labels: ${JSON.stringify(largestData.labels)},
                datasets: [{ label: 'File Size', data: ${JSON.stringify(largestData.data)}, backgroundColor: '#00ff00', borderColor: '#00cccc', borderWidth: 1 }]
            },
            options: {
                ...CHART_DEFAULTS,
                plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { color: '#00ff00', callback: formatBytes }, grid: { color: '#333' } },
                    x: { ticks: { color: '#00ff00', maxRotation: 45 }, grid: { color: '#333' } }
                }
            }
        });
    }` : ''}

    function formatBytes(v) {
        if (!v) return '0 B';
        const k = 1024, s = ['B','KB','MB','GB'];
        const i = Math.floor(Math.log(v) / Math.log(k));
        return (v / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
    }
})();
</script>
</body>
</html>`;
}

export async function generateHtmlReport(result: AnalysisResult, filename?: string): Promise<string> {
    let outputFile = filename ?? `directory-analysis-${new Date().toISOString().slice(0, 10)}.html`;

    if (filename) {
        const s = await stat(filename).catch(() => null);
        if (s?.isDirectory()) {
            outputFile = join(filename, `directory-analysis-${new Date().toISOString().slice(0, 10)}.html`);
        }
    }

    await writeFile(outputFile, generateHTML(result));
    return outputFile;
}
