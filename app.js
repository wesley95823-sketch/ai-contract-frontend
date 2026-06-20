// 核心邏輯與前端互動

let riskChartInstance = null;
let currentReportData = null; // 儲存當前分析結果，供匯出 CSV 使用

document.addEventListener('DOMContentLoaded', () => {
    const clausesContainer = document.getElementById('clausesContainer');
    clausesContainer.addEventListener('toggle', (e) => {
        if (e.target.tagName === 'DETAILS' && e.target.open) {
            const parent = e.target.parentNode;
            const siblings = parent.querySelectorAll(':scope > details');
            siblings.forEach(sibling => {
                if (sibling !== e.target && sibling.hasAttribute('open')) {
                    sibling.removeAttribute('open'); 
                }
            });
        }
    }, true);

    document.getElementById('standardPreview').innerText = standards['rent'];
    
    const selectEl = document.getElementById('standardSelect');
    const demoBtn = document.getElementById('demoBtn');
    selectEl.addEventListener('change', (e) => {
        document.getElementById('standardPreview').innerText = standards[e.target.value];
        
        if (e.target.value === 'rent') {
            demoBtn.innerHTML = '<i class="fa-solid fa-bolt text-amber-500"></i> 載入惡房東範例';
        } else if (e.target.value === 'labor') {
            demoBtn.innerHTML = '<i class="fa-solid fa-bolt text-amber-500"></i> 載入慣老闆範例';
        } else {
            demoBtn.innerHTML = '<i class="fa-solid fa-bolt text-amber-500"></i> 載入不平等借據範例';
        }
    });
});

function loadTrapExample() {
    const currentType = document.getElementById('standardSelect').value;
    document.getElementById('userContract').value = trapExamples[currentType];
}

async function fetchWithRetry(url, options, maxRetries = 5) {
    const delays = [1000, 2000, 4000, 8000, 16000];
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`HTTP 錯誤! 狀態碼: ${response.status}`);
            return await response.json();
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, delays[i]));
        }
    }
}

async function scanContract() {
    const userText = document.getElementById('userContract').value.trim();
    const standardKey = document.getElementById('standardSelect').value;
    const standardText = standards[standardKey];

    if (!userText) {
        alert("請輸入要審閱的契約內容！");
        return;
    }

    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('resultsArea').classList.add('hidden');
    document.getElementById('loadingOverlay').classList.remove('hidden');
    document.getElementById('scanBtn').disabled = true;

    const systemPrompt = `你是一位嚴格且專業的台灣律師。請比對【基準庫】與【使用者合約】。
分類為：'安全'、'須注意'、'危險'、'隱蔽缺失'。

【防呆與自動適應機制】：
1. 請先判斷使用者合約的「真實類型」是否與【基準庫】相符。
2. 若「不相符」，請在 summary 的開頭加上：「⚠️ 警告：系統偵測到合約類型與所選基準庫不符！」
3. 若遇到類型不符，或是使用者選擇了「一般契約(other)」：
   -> 停止尋找隱蔽缺失。
   -> 請改為全面使用台灣民法、消保法的「一般公平原則與強制規定」進行審閱。僅判斷合約條文是否危險、須注意或安全。

一般判定最高指導原則：
1. 【優於底線】：若合約給予的條件優於法定標準，請判定為『安全』。
2. 【生活條約與工作規則】：請著重審視是否符合「比例原則」。不合理的重罰、無理的隱私侵害、強制無薪勞動等，請標示為『危險』或『須注意』。
3. 【抓大放小】：忽略排版格式、錯別字或無關痛癢的行政細節。
4. 【危險認定】：明顯違反法律強制規定（如勞基法預扣薪資、高利貸暴利行為、拋棄全部上訴權等）。
5. 【隱蔽缺失】：僅在合約類型「相符」的前提下，若基準庫有寫的核心保護，合約故意不提，才判定缺失。

請針對每一條文進行精煉的法理分析，並提供白話談判建議。`;

    const userQuery = `<基準庫>\n${standardText}\n</基準庫>\n\n<合約>\n${userText}\n</合約>`;

    const responseSchema = {
        type: "OBJECT",
        properties: {
            summary: { type: "STRING" },
            clauses: {
                type: "ARRAY",
                items: {
                    type: "OBJECT",
                    properties: {
                        article_num: { type: "STRING" },
                        original_text: { type: "STRING" },
                        level: { type: "STRING" },
                        reason: { type: "STRING" },
                        suggestion: { type: "STRING" }
                    }
                }
            }
        }
    };

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { responseMimeType: "application/json", responseSchema: responseSchema }
    };

    try {
        // 呼叫後端
        const apiUrl = 'https://ai-contract-backend.onrender.com/api/scan';
        const data = await fetchWithRetry(apiUrl, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(payload) 
        });
        
        // 解析後端
        const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!resultText) throw new Error("API 未回傳有效文字");
        
        const resultJson = JSON.parse(resultText);
        currentReportData = resultJson; // 儲存供 CSV 下載
        
        const counts = { safe:0, warning:0, danger:0, hidden:0 };
        resultJson.clauses.forEach(c => {
            if(c.level === '安全') counts.safe++;
            else if(c.level === '須注意') counts.warning++;
            else if(c.level === '危險') counts.danger++;
            else counts.hidden++; 
        });
        
        renderResults(resultJson, counts);

    } catch (error) {
        console.error(error);
        document.getElementById('loadingOverlay').classList.add('hidden');
        document.getElementById('emptyState').classList.remove('hidden');
        alert("分析發生錯誤，請確認後端伺服器是否已啟動，或檢查終端機的錯誤訊息。\n詳細錯誤: " + error.message);
    } finally {
        document.getElementById('scanBtn').disabled = false;
    }
}

function renderResults(data, counts) {
    document.getElementById('loadingOverlay').classList.add('hidden');
    document.getElementById('resultsArea').classList.remove('hidden');
    document.getElementById('resultsArea').classList.add('flex');
    
    const isOtherType = document.getElementById('standardSelect').value === 'other';
    const hasWarning = data.summary.includes('⚠️');
    
    const chartTitleEl = document.getElementById('chartTitle');
    if (isOtherType || hasWarning) {
        chartTitleEl.innerHTML = `
            <i class="fa-solid fa-chart-pie text-sky-500 mr-2"></i> 風險分佈圖 
            <span class="ml-auto text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-md border border-amber-200 font-normal shadow-sm" title="此類別非本系統核心功能，分析結果可能不夠精確">
                <i class="fa-solid fa-circle-exclamation"></i> 非主要用途，僅供參考
            </span>`;
    } else {
        chartTitleEl.innerHTML = `<i class="fa-solid fa-chart-pie text-sky-500 mr-2"></i> 風險分佈圖`;
    }

    let summaryHtml = data.summary;
    if (summaryHtml.includes('⚠️')) {
        summaryHtml = summaryHtml.replace('⚠️', '<span class="text-red-500 font-bold text-lg">⚠️</span>');
        summaryHtml = `<div class="bg-red-50 border-l-4 border-red-500 p-3 mb-3 rounded-r text-red-800 font-medium">${summaryHtml}</div>`;
    }
    document.getElementById('summaryText').innerHTML = summaryHtml;
    
    if(riskChartInstance) riskChartInstance.destroy();
    const ctx = document.getElementById('riskChart').getContext('2d');
    
    const total = counts.safe + counts.warning + counts.danger + counts.hidden;
    const chartData = total === 0 ? [1,0,0,0] : [counts.safe, counts.warning, counts.danger, counts.hidden];

    riskChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['安全', '須注意', '危險', '隱蔽缺失'],
            datasets: [{
                data: chartData,
                backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#8b5cf6'],
                borderWidth: 2,
                borderColor: '#ffffff',
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: { position: 'right', labels: { boxWidth: 12, font: { family: "'Noto Sans TC', sans-serif" } } }
            }
        }
    });

    const groups = { '安全': [], '須注意': [], '危險': [], '隱蔽缺失': [] };
    data.clauses.forEach(c => {
        if(groups[c.level]) { groups[c.level].push(c); } 
        else { groups['須注意'].push(c); }
    });

    const container = document.getElementById('clausesContainer');
    container.innerHTML = ''; 

    const styleMap = {
        '安全': { color: 'text-emerald-600', groupBg: 'bg-emerald-50', border: 'border-emerald-200', icon: 'fa-check-circle' },
        '須注意': { color: 'text-amber-600', groupBg: 'bg-amber-50', border: 'border-amber-200', icon: 'fa-triangle-exclamation' },
        '危險': { color: 'text-red-600', groupBg: 'bg-red-50', border: 'border-red-200', icon: 'fa-skull-crossbones' },
        '隱蔽缺失': { color: 'text-purple-600', groupBg: 'bg-purple-50', border: 'border-purple-200', icon: 'fa-eye-slash' }
    };

    const renderOrder = ['安全', '須注意', '危險', '隱蔽缺失'];
    let isFirstGroup = true;

    renderOrder.forEach(level => {
        const items = groups[level];
        if (items.length === 0) return; 

        const style = styleMap[level];
        const isGroupOpen = isFirstGroup ? 'open' : '';
        isFirstGroup = false;

        let groupHtml = `
            <details class="group/outer mb-4 bg-white rounded-xl shadow-sm border ${style.border} overflow-hidden" ${isGroupOpen}>
                <summary class="${style.groupBg} hover:brightness-95 transition cursor-pointer p-3 flex items-center justify-between select-none border-b ${style.border}">
                    <div class="flex items-center gap-3">
                        <i class="fa-solid ${style.icon} ${style.color} text-lg"></i>
                        <span class="font-bold ${style.color} text-md">${level} (${items.length} 項)</span>
                    </div>
                    <div class="flex-shrink-0 ml-2">
                        <i class="fa-solid fa-chevron-down text-slate-400 group-open/outer:-rotate-180 transition-transform duration-300"></i>
                    </div>
                </summary>
                <div class="p-2 bg-slate-50 flex flex-col gap-2">
        `;

        items.forEach(clause => {
            const prefix = (clause.article_num && clause.article_num !== '-') ? `[${clause.article_num}] ` : '[隱蔽/未標號] ';
            const shortText = clause.original_text.length > 25 ? clause.original_text.substring(0, 25) + '...' : clause.original_text;
            const titleStr = `${prefix}${shortText}`;

            groupHtml += `
                <details class="group/inner bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                    <summary class="hover:bg-slate-50 transition cursor-pointer p-3 flex items-center justify-between select-none">
                        <div class="flex items-center gap-3 overflow-hidden">
                            <span class="font-bold text-slate-700 truncate" title="${clause.original_text}">${titleStr}</span>
                        </div>
                        <div class="flex-shrink-0 ml-2">
                            <i class="fa-solid fa-angle-down text-slate-400 group-open/inner:-rotate-180 transition-transform duration-300"></i>
                        </div>
                    </summary>
                    
                    <div class="p-4 border-t border-slate-100 bg-white text-sm">
                        <div class="mb-4">
                            <span class="inline-block bg-slate-100 text-slate-500 text-xs font-bold px-2 py-1 rounded mb-2"><i class="fa-solid fa-align-left"></i> 完整內容</span>
                            <p class="text-slate-800 font-medium leading-relaxed p-3 bg-slate-50 rounded border border-slate-100">${clause.original_text}</p>
                        </div>
                        <div class="grid grid-cols-1 gap-4 mt-2">
                            <div class="bg-red-50/50 p-3 rounded-lg border border-red-100/50">
                                <h4 class="font-bold text-red-800 mb-1 flex items-center gap-2"><i class="fa-solid fa-scale-balanced"></i> 法理分析</h4>
                                <p class="text-slate-600 leading-relaxed">${clause.reason}</p>
                            </div>
                            <div class="bg-sky-50/50 p-3 rounded-lg border border-sky-100/50">
                                <h4 class="font-bold text-sky-800 mb-1 flex items-center gap-2"><i class="fa-solid fa-lightbulb"></i> 建議處置</h4>
                                <p class="text-slate-600 leading-relaxed">${clause.suggestion}</p>
                            </div>
                        </div>
                    </div>
                </details>
            `;
        });

        groupHtml += `</div></details>`;
        container.innerHTML += groupHtml;
    });
}

// 匯出CSV
function exportToCSV() {
    if (!currentReportData || !currentReportData.clauses) {
        alert("尚無可匯出的報告資料！");
        return;
    }
    
    let csvContent = "\uFEFF"; 
    csvContent += "條文編號,風險等級,原文內容,法理分析,建議處置\n";

    currentReportData.clauses.forEach(row => {
        const escapeCSV = (str) => `"${(str || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
        
        const num = escapeCSV(row.article_num);
        const level = escapeCSV(row.level);
        const text = escapeCSV(row.original_text);
        const reason = escapeCSV(row.reason);
        const suggestion = escapeCSV(row.suggestion);
        
        csvContent += `${num},${level},${text},${reason},${suggestion}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "掃雷分析報告.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}