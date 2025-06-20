import { ExtendedAnalysisResult } from './export';
import { formatSize } from './utils';
import { promises as fs } from 'fs';

export class HTMLReportGenerator {
    static async generateReport(result: ExtendedAnalysisResult, filename?: string): Promise<string> {
        let outputFile = filename || `directory-analysis-${new Date().toISOString().slice(0, 10)}.html`;

        // Check if the provided filename is actually a directory
        if (filename) {
            try {
                const stats = await fs.stat(filename);
                if (stats.isDirectory()) {
                    // If it's a directory, generate a filename inside that directory
                    const path = require('path');
                    outputFile = path.join(filename, `directory-analysis-${new Date().toISOString().slice(0, 10)}.html`);
                }
            } catch (error) {
                // If stat fails, assume it's a valid filename (file doesn't exist yet)
                outputFile = filename;
            }
        }

        const html = this.generateHTML(result);
        await fs.writeFile(outputFile, html);

        return outputFile;
    }

    private static generateHTML(result: ExtendedAnalysisResult): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Directory Analysis Report - ${result.path}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        ${this.getCSS()}
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <h1>📂 Directory Analysis Report</h1>
            <p class="path">📍 ${result.path}</p>
            <p class="timestamp">📅 Generated on ${new Date().toLocaleString()}</p>
        </header>

        <div class="summary-grid">
            <div class="summary-card">
                <div class="summary-icon">📦</div>
                <div class="summary-content">
                    <h3>Total Size</h3>
                    <p class="summary-value">${formatSize(result.totalSizeBytes)}</p>
                </div>
            </div>
            <div class="summary-card">
                <div class="summary-icon">📄</div>
                <div class="summary-content">
                    <h3>Files</h3>
                    <p class="summary-value">${result.files.toLocaleString()}</p>
                </div>
            </div>
            <div class="summary-card">
                <div class="summary-icon">📁</div>
                <div class="summary-content">
                    <h3>Folders</h3>
                    <p class="summary-value">${result.folders.toLocaleString()}</p>
                </div>
            </div>
            <div class="summary-card">
                <div class="summary-icon">🗂️</div>
                <div class="summary-content">
                    <h3>File Types</h3>
                    <p class="summary-value">${this.countNonZeroTypes(result.types)}</p>
                </div>
            </div>
        </div>

        <div class="charts-container">
            <div class="chart-section">
                <h2>📊 File Type Distribution</h2>
                <div class="chart-wrapper">
                    <canvas id="fileTypeChart"></canvas>
                </div>
            </div>

            ${result.topLargestFiles && result.topLargestFiles.length > 0 ? `
            <div class="chart-section">
                <h2>📈 Largest Files</h2>
                <div class="chart-wrapper">
                    <canvas id="largestFilesChart"></canvas>
                </div>
            </div>
            ` : ''}
        </div>

        ${result.largeFiles && result.largeFiles.length > 0 ? `
        <div class="section">
            <h2>🚨 Large Files</h2>
            <div class="table-wrapper">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>File Path</th>
                            <th>Size</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${result.largeFiles.slice(0, 20).map(file => `
                            <tr>
                                <td class="file-path">${this.escapeHtml(file.path)}</td>
                                <td class="file-size">${file.sizeFormatted}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        ` : ''}

        ${result.duplicateGroups && result.duplicateGroups.length > 0 ? `
        <div class="section">
            <h2>🔄 Duplicate Files</h2>
            <div class="duplicate-stats">
                <p>📊 Total Groups: <strong>${result.duplicateGroups.length}</strong></p>
                ${result.duplicateStats ? `
                    <p>💾 Wasted Space: <strong>${result.duplicateStats.totalWastedSpaceFormatted}</strong></p>
                ` : ''}
            </div>
            <div class="duplicate-groups">
                ${result.duplicateGroups.slice(0, 10).map((group, index) => `
                    <div class="duplicate-group">
                        <h4>Group ${index + 1} - ${group.sizeFormatted} each × ${group.files.length} files</h4>
                        <ul class="duplicate-files">
                            ${group.files.slice(0, 5).map(file => `
                                <li class="duplicate-file">${this.escapeHtml(file)}</li>
                            `).join('')}
                            ${group.files.length > 5 ? `
                                <li class="more-files">... and ${group.files.length - 5} more files</li>
                            ` : ''}
                        </ul>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

        ${result.emptyFiles && result.emptyFiles.length > 0 ? `
        <div class="section">
            <h2>📭 Empty Files</h2>
            <div class="table-wrapper">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>File Path</th>
                            <th>Modified Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${result.emptyFiles.slice(0, 20).map(file => `
                            <tr>
                                <td class="file-path">${this.escapeHtml(file.path)}</td>
                                <td class="file-date">${file.modifiedDate.toLocaleDateString()}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        ` : ''}

        <footer class="footer">
            <p>Generated by Dir Analyzer v1.0.0</p>
        </footer>
    </div>

    <script>
        ${this.getJavaScript(result)}
    </script>
</body>
</html>`;
    } private static getCSS(): string {
        return `
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }

            body {
                font-family: 'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace;
                line-height: 1.6;
                color: #00ff00;
                background: #0a0a0a;
                min-height: 100vh;
                background-image: 
                    linear-gradient(90deg, rgba(0,255,0,0.03) 1px, transparent 1px),
                    linear-gradient(rgba(0,255,0,0.03) 1px, transparent 1px);
                background-size: 20px 20px;
            }

            .container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 20px;
            }

            .header {
                background: #1a1a1a;
                padding: 30px;
                border: 2px solid #00ff00;
                border-radius: 8px;
                box-shadow: 0 0 20px rgba(0,255,0,0.3);
                margin-bottom: 30px;
                text-align: center;
                position: relative;
            }

            .header::before {
                content: '> ';
                position: absolute;
                left: 15px;
                top: 15px;
                color: #00ff00;
                font-weight: bold;
            }

            .header h1 {
                font-size: 2.5em;
                margin-bottom: 10px;
                color: #00ff00;
                text-shadow: 0 0 10px rgba(0,255,0,0.5);
                font-weight: bold;
            }

            .path {
                font-size: 1.2em;
                color: #00cccc;
                margin-bottom: 5px;
                font-family: 'Fira Code', monospace;
            }

            .timestamp {
                color: #666;
                font-family: 'Fira Code', monospace;
            }

            .summary-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 20px;
                margin-bottom: 30px;
            }

            .summary-card {
                background: #1a1a1a;
                padding: 25px;
                border: 1px solid #333;
                border-radius: 8px;
                box-shadow: 0 0 15px rgba(0,255,0,0.1);
                display: flex;
                align-items: center;
                transition: all 0.3s ease;
                position: relative;
            }

            .summary-card::before {
                content: '$ ';
                position: absolute;
                left: 10px;
                top: 10px;
                color: #00ff00;
                font-size: 0.9em;
            }

            .summary-card:hover {
                border-color: #00ff00;
                box-shadow: 0 0 25px rgba(0,255,0,0.3);
                transform: translateY(-2px);
            }

            .summary-icon {
                font-size: 3em;
                margin-right: 20px;
                filter: grayscale(1) brightness(1.5);
            }

            .summary-content h3 {
                color: #00cccc;
                margin-bottom: 5px;
                text-transform: uppercase;
                letter-spacing: 1px;
            }

            .summary-value {
                font-size: 2em;
                font-weight: bold;
                color: #00ff00;
                text-shadow: 0 0 5px rgba(0,255,0,0.5);
            }

            .charts-container {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
                gap: 30px;
                margin-bottom: 30px;
            }

            .chart-section {
                background: #1a1a1a;
                padding: 25px;
                border: 1px solid #333;
                border-radius: 8px;
                box-shadow: 0 0 15px rgba(0,255,0,0.1);
                position: relative;
            }

            .chart-section::before {
                content: '>> ';
                position: absolute;
                left: 10px;
                top: 10px;
                color: #00ff00;
                font-size: 0.9em;
            }

            .chart-section h2 {
                margin-bottom: 20px;
                color: #00ff00;
                text-transform: uppercase;
                letter-spacing: 1px;
                border-bottom: 2px solid #00ff00;
                padding-bottom: 10px;
            }

            .chart-wrapper {
                position: relative;
                height: 300px;
            }

            .section {
                background: #1a1a1a;
                padding: 25px;
                border: 1px solid #333;
                border-radius: 8px;
                box-shadow: 0 0 15px rgba(0,255,0,0.1);
                margin-bottom: 30px;
                position: relative;
            }

            .section::before {
                content: '>>> ';
                position: absolute;
                left: 10px;
                top: 10px;
                color: #00ff00;
                font-size: 0.9em;
            }

            .section h2 {
                margin-bottom: 20px;
                color: #00ff00;
                border-bottom: 2px solid #00ff00;
                padding-bottom: 10px;
                text-transform: uppercase;
                letter-spacing: 1px;
            }

            .table-wrapper {
                overflow-x: auto;
            }

            .data-table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 10px;
                border: 1px solid #333;
            }

            .data-table th,
            .data-table td {
                padding: 12px;
                text-align: left;
                border-bottom: 1px solid #333;
                border-right: 1px solid #333;
            }

            .data-table th {
                background: #0d0d0d;
                font-weight: 600;
                color: #00cccc;
                text-transform: uppercase;
                letter-spacing: 1px;
            }

            .data-table tr:hover {
                background: #2a2a2a;
            }

            .file-path {
                font-family: 'Fira Code', 'Consolas', monospace;
                font-size: 0.9em;
                color: #00ff00;
            }

            .file-size {
                font-weight: 600;
                color: #ff6b6b;
                font-family: 'Fira Code', monospace;
            }

            .file-date {
                color: #666;
                font-family: 'Fira Code', monospace;
            }

            .duplicate-stats {
                background: #0d0d0d;
                padding: 15px;
                border: 1px solid #333;
                border-radius: 4px;
                margin-bottom: 20px;
            }

            .duplicate-group {
                border: 1px solid #333;
                border-radius: 4px;
                margin-bottom: 15px;
                padding: 15px;
                background: #0d0d0d;
            }

            .duplicate-group h4 {
                color: #00cccc;
                margin-bottom: 10px;
                font-family: 'Fira Code', monospace;
            }

            .duplicate-files {
                list-style: none;
            }

            .duplicate-file {
                padding: 5px 0;
                font-family: 'Fira Code', monospace;
                font-size: 0.9em;
                color: #00ff00;
            }

            .duplicate-file::before {
                content: '  - ';
                color: #666;
            }

            .more-files {
                padding: 5px 0;
                color: #666;
                font-style: italic;
                font-family: 'Fira Code', monospace;
            }

            .footer {
                text-align: center;
                padding: 20px;
                color: #666;
                font-size: 0.9em;
                font-family: 'Fira Code', monospace;
                border-top: 1px solid #333;
                margin-top: 30px;
            }

            .footer::before {
                content: '~$ ';
                color: #00ff00;
            }

            @media (max-width: 768px) {
                .container {
                    padding: 10px;
                }

                .header h1 {
                    font-size: 2em;
                }

                .summary-grid {
                    grid-template-columns: 1fr;
                }

                .charts-container {
                    grid-template-columns: 1fr;
                }

                .summary-card {
                    text-align: center;
                    flex-direction: column;
                }

                .summary-icon {
                    margin-right: 0;
                    margin-bottom: 10px;
                }
            }
        `;
    }

    private static getJavaScript(result: ExtendedAnalysisResult): string {
        const fileTypeData = this.getFileTypeChartData(result.types);
        const largestFilesData = this.getLargestFilesChartData(result.topLargestFiles);

        return `            // File Type Chart
            const fileTypeCtx = document.getElementById('fileTypeChart').getContext('2d');
            new Chart(fileTypeCtx, {
                type: 'doughnut',
                data: {
                    labels: ${JSON.stringify(fileTypeData.labels)},
                    datasets: [{
                        data: ${JSON.stringify(fileTypeData.data)},
                        backgroundColor: [
                            '#00ff00', '#00cccc', '#ffff00', '#ff6b6b',
                            '#9966ff', '#ff9900', '#66ff66', '#ff3366'
                        ],
                        borderColor: '#0a0a0a',
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                padding: 20,
                                usePointStyle: true,
                                color: '#00ff00',
                                font: {
                                    family: 'Fira Code, Consolas, Monaco, monospace',
                                    size: 12
                                }
                            }
                        },
                        tooltip: {
                            backgroundColor: '#1a1a1a',
                            titleColor: '#00ff00',
                            bodyColor: '#00cccc',
                            borderColor: '#333',
                            borderWidth: 1,
                            titleFont: {
                                family: 'Fira Code, Consolas, Monaco, monospace'
                            },
                            bodyFont: {
                                family: 'Fira Code, Consolas, Monaco, monospace'
                            },
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((value / total) * 100).toFixed(1);
                                    return label + ': ' + value + ' files (' + percentage + '%)';
                                }
                            }
                        }
                    }
                }
            });

            ${result.topLargestFiles && result.topLargestFiles.length > 0 ? `
            // Largest Files Chart
            const largestFilesCtx = document.getElementById('largestFilesChart').getContext('2d');
            new Chart(largestFilesCtx, {
                type: 'bar',
                data: {
                    labels: ${JSON.stringify(largestFilesData.labels)},
                    datasets: [{
                        label: 'File Size',
                        data: ${JSON.stringify(largestFilesData.data)},
                        backgroundColor: '#00ff00',
                        borderColor: '#00cccc',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                color: '#00ff00',
                                font: {
                                    family: 'Fira Code, Consolas, Monaco, monospace'
                                },
                                callback: function(value) {
                                    return formatBytes(value);
                                }
                            },
                            grid: {
                                color: '#333'
                            }
                        },
                        x: {
                            ticks: {
                                color: '#00ff00',
                                font: {
                                    family: 'Fira Code, Consolas, Monaco, monospace'
                                },
                                maxRotation: 45,
                                minRotation: 45
                            },
                            grid: {
                                color: '#333'
                            }
                        }
                    },
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: {
                            backgroundColor: '#1a1a1a',
                            titleColor: '#00ff00',
                            bodyColor: '#00cccc',
                            borderColor: '#333',
                            borderWidth: 1,
                            titleFont: {
                                family: 'Fira Code, Consolas, Monaco, monospace'
                            },
                            bodyFont: {
                                family: 'Fira Code, Consolas, Monaco, monospace'
                            },
                            callbacks: {
                                label: function(context) {
                                    return 'Size: ' + formatBytes(context.parsed.y);
                                }
                            }
                        }
                    }
                }
            });
            ` : ''}

            function formatBytes(bytes) {
                if (bytes === 0) return '0 Bytes';
                const k = 1024;
                const sizes = ['Bytes', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
            }
        `;
    }

    private static getFileTypeChartData(types: any): { labels: string[], data: number[] } {
        const typeMapping = {
            code: '🧑‍💻 Code',
            images: '📷 Images',
            documents: '📄 Documents',
            videos: '🎬 Videos',
            audio: '🎵 Audio',
            archives: '🗃️ Archives',
            other: '❓ Other'
        };

        const labels: string[] = [];
        const data: number[] = [];

        Object.entries(types).forEach(([key, value]) => {
            if ((value as number) > 0) {
                labels.push(typeMapping[key as keyof typeof typeMapping] || key);
                data.push(value as number);
            }
        });

        return { labels, data };
    }

    private static getLargestFilesChartData(topFiles?: any[]): { labels: string[], data: number[] } {
        if (!topFiles || topFiles.length === 0) {
            return { labels: [], data: [] };
        }

        const labels = topFiles.map(file => {
            const fileName = file.path.split(/[/\\]/).pop() || file.path;
            return fileName.length > 20 ? fileName.substring(0, 17) + '...' : fileName;
        });

        const data = topFiles.map(file => file.size);

        return { labels, data };
    }

    private static countNonZeroTypes(types: any): number {
        return Object.values(types).filter(count => (count as number) > 0).length;
    } private static escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}
