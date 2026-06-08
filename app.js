/**
 * app.js - 智慧公文產生器核心程式
 * 合併本地資料庫管理 (LocalStorage DB)、公文生成引擎 (Generator) 與 UI 控制器 (App Controller)。
 * 本檔案採純前端自包含架構，支援雙擊 index.html 即可於瀏覽器中直接流暢執行，無 CORS 跨域限制。
 */

// ============================================================================
// 1. 本地資料庫模組 (原本的 db.js)
// ============================================================================

const STORAGE_KEYS = {
    CHATS: 'gov_doc_generator_chats',
    SETTINGS: 'gov_doc_generator_settings',
    TRAINING_DOCS: 'gov_doc_generator_training_docs'
};

// 預設的永久歷史公文訓練資料與設定由 templates.js 提供
const DEFAULT_TRAINING_DOCS = window.DEFAULT_TRAINING_DOCS || [];
const DEFAULT_SETTINGS = window.DEFAULT_SETTINGS || {
    geminiApiKey: '',
    openaiApiKey: '',
    systemPrompt: ''
};

const DB = {
    getChats() {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.CHATS);
            if (!data) return [];
            return JSON.parse(data);
        } catch (e) {
            console.error('讀取對話紀錄失敗:', e);
            return [];
        }
    },

    saveChats(chats) {
        try {
            localStorage.setItem(STORAGE_KEYS.CHATS, JSON.stringify(chats));
            return true;
        } catch (e) {
            console.error('儲存對話紀錄失敗:', e);
            return false;
        }
    },

    createChat(title = '新公文對話') {
        const chats = this.getChats();
        const newChat = {
            id: 'chat-' + Date.now(),
            title: title,
            messages: [
                {
                    id: 'msg-init',
                    sender: 'assistant',
                    text: '您好！我是您的**智慧公文簽辦助理**。✍️\n\n您可以隨時在下方輸入「來文摘要」或**上傳本次對話使用的公文/附件**。我將會參考您在左側上傳的「永久歷史公文庫」，為您生成符合您機關風格與標準的中華民國公文「簽」草稿。\n\n請問今天有什麼公文需要簽辦嗎？',
                    timestamp: Date.now()
                }
            ],
            files: []
        };
        chats.unshift(newChat);
        this.saveChats(chats);
        return newChat;
    },

    deleteChat(chatId) {
        let chats = this.getChats();
        chats = chats.filter(c => c.id !== chatId);
        this.saveChats(chats);
        return chats;
    },

    renameChat(chatId, newTitle) {
        const chats = this.getChats();
        const chat = chats.find(c => c.id === chatId);
        if (chat) {
            chat.title = newTitle.trim() || '未命名對話';
            this.saveChats(chats);
        }
        return chats;
    },

    addMessage(chatId, message) {
        const chats = this.getChats();
        const chat = chats.find(c => c.id === chatId);
        if (chat) {
            message.id = 'msg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
            message.timestamp = Date.now();
            chat.messages.push(message);
            this.saveChats(chats);
            return chat;
        }
        return null;
    },

    addFileToChat(chatId, file) {
        const chats = this.getChats();
        const chat = chats.find(c => c.id === chatId);
        if (chat) {
            chat.files = chat.files || [];
            if (!chat.files.some(f => f.name === file.name)) {
                chat.files.push({
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    content: file.content
                });
                this.saveChats(chats);
            }
            return chat;
        }
        return null;
    },

    removeFileFromChat(chatId, fileName) {
        const chats = this.getChats();
        const chat = chats.find(c => c.id === chatId);
        if (chat) {
            chat.files = (chat.files || []).filter(f => f.name !== fileName);
            this.saveChats(chats);
            return chat;
        }
        return null;
    },

    getTrainingDocs() {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.TRAINING_DOCS);
            if (!data) {
                localStorage.setItem(STORAGE_KEYS.TRAINING_DOCS, JSON.stringify(DEFAULT_TRAINING_DOCS));
                return DEFAULT_TRAINING_DOCS;
            }
            return JSON.parse(data);
        } catch (e) {
            console.error('讀取歷史公文庫失敗:', e);
            return DEFAULT_TRAINING_DOCS;
        }
    },

    saveTrainingDocs(docs) {
        try {
            localStorage.setItem(STORAGE_KEYS.TRAINING_DOCS, JSON.stringify(docs));
            return true;
        } catch (e) {
            console.error('儲存歷史公文庫失敗:', e);
            return false;
        }
    },

    addTrainingDoc(doc) {
        const docs = this.getTrainingDocs();
        const newDoc = {
            id: 'train-' + Date.now(),
            title: doc.title || '歷史公文範本',
            docType: doc.docType || '簽',
            incomingText: doc.incomingText || '',
            draftText: doc.draftText || '',
            attachmentDesc: doc.attachmentDesc || '',
            attachments: doc.attachments || [],
            timestamp: Date.now()
        };
        docs.unshift(newDoc);
        this.saveTrainingDocs(docs);
        return newDoc;
    },

    deleteTrainingDoc(docId) {
        let docs = this.getTrainingDocs();
        docs = docs.filter(d => d.id !== docId);
        this.saveTrainingDocs(docs);
        return docs;
    },

    getSettings() {
        try {
            const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
            if (!data) {
                localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(DEFAULT_SETTINGS));
                return DEFAULT_SETTINGS;
            }
            return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
        } catch (e) {
            console.error('讀取設定失敗:', e);
            return DEFAULT_SETTINGS;
        }
    },

    saveSettings(settings) {
        try {
            const current = this.getSettings();
            const updated = { ...current, ...settings };
            localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
            return true;
        } catch (e) {
            console.error('儲存設定失敗:', e);
            return false;
        }
    }
};

// ============================================================================
// 2. 公文生成引擎模組 (原本的 generator.js)
// ============================================================================

function generateDocNumber() {
    const year = new Date().getFullYear() - 1911;
    const randomNum = Math.floor(1000000000 + Math.random() * 900000000);
    return `${year}${randomNum}`;
}

function getROCDateString() {
    const today = new Date();
    const year = today.getFullYear() - 1911;
    const month = today.getMonth() + 1;
    const date = today.getDate();
    return `中華民國${year}年${month}月${date}日`;
}

function generateMockDocument(promptText, sessionFiles = [], trainingDocs = []) {
    const keywords = promptText.toLowerCase();
    let dept = '秘書室';
    let docNum = generateDocNumber();
    let dateStr = getROCDateString();
    let security = '普通';
    let speed = '普通';

    if (keywords.includes('資訊') || keywords.includes('系統') || keywords.includes('網路') || keywords.includes('軟體') || keywords.includes('伺服器')) {
        dept = '資訊推廣科';
    } else if (keywords.includes('採購') || keywords.includes('工程') || keywords.includes('招標') || keywords.includes('合約')) {
        dept = '總務科';
    } else if (keywords.includes('活動') || keywords.includes('宣導') || keywords.includes('文創') || keywords.includes('藝術')) {
        dept = '業務推廣科';
    } else if (keywords.includes('出差') || keywords.includes('參訪') || keywords.includes('研習') || keywords.includes('培訓')) {
        dept = '人事室';
    }

    if (keywords.includes('緊急') || keywords.includes('立刻') || keywords.includes('最速') || keywords.includes('馬上')) {
        speed = '最速件';
    } else if (keywords.includes('速件') || keywords.includes('儘快') || keywords.includes('下週')) {
        speed = '速件';
    }

    let budgetMatch = promptText.match(/(\d+,?\d*)\s*(萬|元|整)/);
    let budgetText = budgetMatch ? budgetMatch[0] : '新臺幣10萬元整';

    let topic = '有關辦理業務推動';
    if (keywords.includes('採購') || keywords.includes('買')) {
        topic = '擬辦理「資訊硬體設備與維護採購」';
    } else if (keywords.includes('會議') || keywords.includes('籌備')) {
        topic = '函邀共同主辦籌備會議並派員出席';
    } else if (keywords.includes('出差') || keywords.includes('考察') || keywords.includes('出國')) {
        topic = '擬派員赴海外進行業務考察與交流';
    } else if (keywords.includes('系統') || keywords.includes('網站') || keywords.includes('升級')) {
        topic = '擬規劃「核心資訊系統升級暨雲端移轉計畫」';
    } else if (keywords.includes('經費') || keywords.includes('補助') || keywords.includes('申請')) {
        topic = '擬申請經費補助以推動年度創新業務計畫';
    }

    let fileDesc = '';
    if (sessionFiles.length > 0) {
        fileDesc = `及隨文檢附之「${sessionFiles[0].name}」等相關參考資料`;
    }

    let doc = {
        dept,
        docNum,
        dateStr,
        security,
        speed,
        subject: '',
        explanation: [],
        proposal: []
    };

    if (keywords.includes('採購') || keywords.includes('買') || keywords.includes('招標')) {
        doc.subject = `關於${topic}一案，擬同意辦理公開招標採購，簽請核示。`;
        doc.explanation = [
            `依據本局年度工作計畫及各科室提報之資訊化需求辦理${fileDesc}。`,
            `本案採購標的為高效能伺服器與資料備份儲存設備，旨在解決核心業務系統容量不足之問題，確保資料安全性與系統穩定度。`,
            `經費預算估計約為${budgetText}，擬由本局本年度「一般行政管理－資訊設備購置」預算項下勻支。`,
            `本案規格需求及公開招標招標規格書草案，均已由本科承辦同仁會同技術人員研擬完竣（隨文檢附招標規格書草案影本乙份）。`
        ];
        doc.proposal = [
            `本案擬同意依政府採購法相關規定辦理公開招標程序。`,
            `本案採購經費${budgetText}，擬由「一般行政管理」科目項下支應，並於奉核後移請總務科續行辦理招標採購事宜。`,
            `擬同意成立採購工作小組，並指派適當人員擔任審查小組成員，辦理後續規格審查與評選工作。`
        ];
    } else if (keywords.includes('會議') || keywords.includes('籌備') || keywords.includes('活動') || keywords.includes('節')) {
        doc.subject = `關於合作辦理「年度業務推廣與跨機關合作研討會」並派員出席籌備會一案，簽請核示。`;
        doc.explanation = [
            `依據合作機關函送之邀請函及計畫草案辦理${fileDesc}。`,
            `旨揭活動訂於本年度9月中旬假本局二樓多功能大禮堂舉行，旨在加強產官學界之合作交流，推廣數位轉型成效。`,
            `籌備會議訂於本週五下午2時召開，涉及大會流程、展區分配、經費預算分攤等核心議題。`,
            `本局應分攤之會務經費預估為${budgetText}，擬於本年度「業務推廣與公關業務費」項下勻支。`
        ];
        doc.proposal = [
            `擬同意指派${dept}張科長偕同業務承辦同仁出席旨揭會議，以利掌握籌備進度，會後提報工作紀要。`,
            `有關經費分攤，擬以${budgetText}為上限，同意由本局相關預算支應。`,
            `奉核後，即覆函主辦單位確認出席人員名單。`
        ];
    } else if (keywords.includes('系統') || keywords.includes('網站') || keywords.includes('升級') || keywords.includes('維護')) {
        doc.subject = `有關規劃辦理「${topic}」案，為提升資通安全防護及使用者經驗，簽請核示。`;
        doc.explanation = [
            `依據國家資通安全研究院最新資安規範防護指引，及本局核心系統效能檢測報告辦理${fileDesc}。`,
            `旨揭系統建置至今已逾4年，部分底層架構老舊，且面臨高流量時連線延遲問題。本次升級重點為強化SSL加密、導入多因子驗證（MFA）及雲端高可用性部署。`,
            `本案委外開發及系統整合經費預估約為${budgetText}，擬由本年度「資訊軟硬體維護及開發預算」支應。`
        ];
        doc.proposal = [
            `本案擬同意辦理公開評選招標，委託專業資訊服務廠商進行系統升級開發。`,
            `為配合業務不中斷原則，系統移轉工作擬安排於週末或離峰時段進行，並要求廠商妥善擬具備援防護計畫。`,
            `奉核後，本案規格與招標需求擬送請總務科採購小組依程序辦理發包。`
        ];
    } else if (keywords.includes('出差') || keywords.includes('參訪') || keywords.includes('出國') || keywords.includes('考察')) {
        doc.subject = `有關${topic}，擬派員隨團出席並辦理公務出差一案，簽請核示。`;
        doc.explanation = [
            `依據主管機關函送之交流考察計畫及出訪日程表辦理${fileDesc}。`,
            `本次考察旨在汲取國外標竿城市在智慧政府與智慧防災領域之成功經驗，並建立長效交流合作渠道，極具業務參考效益。`,
            `出訪時間預計為本年6月15日至6月22日，共計8日。隨行團員包括業務主管及主辦同仁。`,
            `本案出國旅費與雜支預估為${budgetText}，擬由本局本年度「因公出國考察業務經費」預算項下勻支。`
        ];
        doc.proposal = [
            `擬派${dept}相關人員隨團出訪，並依公務出國規定辦理出差申請。`,
            `出國旅費${budgetText}擬由出國考察專門預算支應，超出部分擬由承辦科室相關業務費進行調整。`,
            `奉核後，承辦人將於返國後三個月內依規定撰寫並繳交出國考察報告上傳至政府門戶網站。`
        ];
    } else {
        const summary = promptText.length > 50 ? promptText.substring(0, 50) + '...' : promptText;
        doc.subject = `有關擬規劃辦理「${summary}」業務推動方案一案，簽請核示。`;
        doc.explanation = [
            `依據本局最新業務指導方針與當前施政方針辦理${fileDesc}。`,
            `查本案之旨意在於解決前述業務執行中面臨之瓶頸，提升民眾滿意度與行政效率，極具辦理之必要性。`,
            `本案執行所需經費，擬由本局本年度相關業務科目項下勻支辦理，預估經費以核實列支為原則。`,
            `隨文檢附相關業務規劃草案及需求說明書乙份，以供參酌。`
        ];
        doc.proposal = [
            `本案擬同意照案辦理，由${dept}擔任主辦科室，並邀集相關科室召開工作小組會議。`,
            `經費部分擬依實際預算核實支應。`,
            `奉核後辦理後續執行細節。`
        ];
    }

    return formatDocOutput(doc);
}

function formatDocOutput(doc) {
    const expLines = doc.explanation.map((item, index) => {
        const num = ['一', '二', '三', '四', '五', '六'][index];
        return `${num}、${item}`;
    }).join('\n');

    const propLines = doc.proposal.map((item, index) => {
        const num = ['一', '二', '三', '四', '五', '六'][index];
        const cleanItem = item.replace(/^[一二三四五六]、/, '').trim();
        return `${num}、${cleanItem}`;
    }).join('\n');

    return `【公文簽辦草稿】
機關：${doc.dept}
文號：${doc.docNum}
日期：${doc.dateStr}
密等及解密條件：${doc.security}
速別：${doc.speed}

主旨：
${doc.subject}

說明：
${expLines}

擬辦：
${propLines}`;
}

async function generateAiDocument(apiKey, provider, promptText, sessionFiles = [], trainingDocs = [], systemPrompt = '') {
    let contextPrompt = '';
    if (trainingDocs && trainingDocs.length > 0) {
        contextPrompt += `以下是使用者的機關「永久歷史公文範本（訓練範例）」，你必須學習其用語風格、公文架構、層級標號及結尾用詞：\n\n`;
        trainingDocs.forEach((doc, idx) => {
            contextPrompt += `【歷史公文範本 ${idx + 1}】\n`;
            contextPrompt += `[公文類型]: ${doc.docType || '簽'}\n`;
            contextPrompt += `[歷史來文內容]:\n${doc.incomingText}\n`;
            if (doc.attachments && doc.attachments.length > 0) {
                const attNames = doc.attachments.map(a => a.name).join(', ');
                contextPrompt += `[歷史上傳附件]: ${attNames}\n`;
            }
            if (doc.attachmentDesc) {
                contextPrompt += `[歷史附件說明]:\n${doc.attachmentDesc}\n`;
            }
            contextPrompt += `[對應簽辦公文草稿]:\n${doc.draftText}\n`;
            contextPrompt += `--------------------\n\n`;
        });
    }

    let filesPrompt = '';
    if (sessionFiles && sessionFiles.length > 0) {
        filesPrompt += `【本次上傳的單次公文檔案/附件】：\n`;
        sessionFiles.forEach((file, idx) => {
            filesPrompt += `[檔案 ${idx + 1}] 名稱: ${file.name}\n`;
            if (file.type && file.type.startsWith('text/')) {
                filesPrompt += `檔案內容: ${file.content}\n`;
            } else {
                filesPrompt += `檔案描述: 這是一份上傳的附件檔案，檔案大小為 ${Math.round(file.size / 1024)} KB。\n`;
            }
            filesPrompt += `---\n`;
        });
    }

    const todayDate = getROCDateString();
    const mockDocNum = generateDocNumber();

    const userPrompt = `${contextPrompt}
${filesPrompt}

【本次簽辦來文內容與指令】：
${promptText}

【重要說明】：
請依據上述的「來文內容」與「歷史公文範本」風格，為我撰寫一份標準的中華民國政府機關公文「簽」草稿。
請使用與歷史公文一致的機關名稱、字號格式、專業官話（如勻支、擬同意辦理、奉核後）。
如果沒有特定的機關或文號，可以預設使用以下資訊：
- 機關：秘書室 (或依據來文性質判斷科室)
- 文號：${mockDocNum}
- 日期：${todayDate}
- 密等及解密條件：普通
- 速別：普通 (或依緊急情況調整)

請務必包含且僅輸出標準公文格式，最下方有「主旨」、「說明」、「擬辦」三大段落。請直接輸出，不要有多餘的聊天寒暄、不要Markdown的包裹代碼（如 \`\`\` ）。`;

    if (provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

        const payload = {
            contents: [
                {
                    parts: [
                        { text: systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.2,
                topP: 0.95
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || `Gemini API 請求失敗，狀態碼 ${response.status}`);
        }

        const data = await response.json();
        let resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!resultText) throw new Error('Gemini API 未回傳有效文字內容');

        resultText = resultText.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '');
        return resultText.trim();
    }

    if (provider === 'openai') {
        const url = `https://api.openai.com/v1/chat/completions`;
        const payload = {
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            temperature: 0.2
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || `OpenAI API 請求失敗，狀態碼 ${response.status}`);
        }

        const data = await response.json();
        let resultText = data.choices?.[0]?.message?.content;
        if (!resultText) throw new Error('OpenAI API 未回傳有效文字內容');

        resultText = resultText.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '');
        return resultText.trim();
    }

    throw new Error('未支援的 AI 提供商');
}

function parseDocumentDraft(draftText) {
    const doc = {
        dept: '秘書室',
        docNum: '',
        dateStr: '',
        security: '普通',
        speed: '普通',
        subject: '',
        explanation: '',
        proposal: '',
        raw: draftText
    };

    try {
        const lines = draftText.split('\n');

        let inSubject = false;
        let inExplanation = false;
        let inProposal = false;

        let subjectLines = [];
        let explanationLines = [];
        let proposalLines = [];

        for (let line of lines) {
            const trimmedLine = line.trim();

            if (trimmedLine.startsWith('機關：') || trimmedLine.startsWith('機關:')) {
                doc.dept = trimmedLine.replace(/^機關[：:]/, '').trim();
                continue;
            }
            if (trimmedLine.startsWith('文號：') || trimmedLine.startsWith('文號:')) {
                doc.docNum = trimmedLine.replace(/^文號[：:]/, '').trim();
                continue;
            }
            if (trimmedLine.startsWith('日期：') || trimmedLine.startsWith('日期:')) {
                doc.dateStr = trimmedLine.replace(/^日期[：:]/, '').trim();
                continue;
            }
            if (trimmedLine.startsWith('密等及解密條件：') || trimmedLine.startsWith('密等及解密條件:') || trimmedLine.startsWith('密等：') || trimmedLine.startsWith('密等:')) {
                doc.security = trimmedLine.replace(/^密等及解密條件[：:]|^密等[：:]/, '').trim();
                continue;
            }
            if (trimmedLine.startsWith('速別：') || trimmedLine.startsWith('速別:')) {
                doc.speed = trimmedLine.replace(/^速別[：:]/, '').trim();
                continue;
            }

            if (trimmedLine === '主旨' || trimmedLine === '主旨：' || trimmedLine === '主旨:') {
                inSubject = true;
                inExplanation = false;
                inProposal = false;
                continue;
            }
            if (trimmedLine === '說明' || trimmedLine === '說明：' || trimmedLine === '說明:') {
                inSubject = false;
                inExplanation = true;
                inProposal = false;
                continue;
            }
            if (trimmedLine === '擬辦' || trimmedLine === '擬辦：' || trimmedLine === '擬辦:') {
                inSubject = false;
                inExplanation = false;
                inProposal = true;
                continue;
            }

            if (inSubject) {
                subjectLines.push(line);
            } else if (inExplanation) {
                explanationLines.push(line);
            } else if (inProposal) {
                proposalLines.push(line);
            }
        }

        doc.subject = subjectLines.join('\n').trim();
        doc.explanation = explanationLines.join('\n').trim();
        doc.proposal = proposalLines.join('\n').trim();

        if (!doc.docNum) doc.docNum = generateDocNumber();
        if (!doc.dateStr) doc.dateStr = getROCDateString();

    } catch (e) {
        console.error('解析公文格式出錯，使用純文字降級:', e);
    }

    return doc;
}

const Generator = {
    async generate(promptText, sessionFiles = []) {
        const settings = DB.getSettings();
        const trainingDocs = DB.getTrainingDocs();

        let resultText = '';

        if (settings.geminiApiKey) {
            resultText = await generateAiDocument(
                settings.geminiApiKey,
                'gemini',
                promptText,
                sessionFiles,
                trainingDocs,
                settings.systemPrompt
            );
        } else if (settings.openaiApiKey) {
            resultText = await generateAiDocument(
                settings.openaiApiKey,
                'openai',
                promptText,
                sessionFiles,
                trainingDocs,
                settings.systemPrompt
            );
        } else {
            resultText = generateMockDocument(promptText, sessionFiles, trainingDocs);
        }

        return {
            text: resultText,
            docData: parseDocumentDraft(resultText)
        };
    }
};

// ============================================================================
// 3. UI 交互控制器與應用邏輯 (原本的 app.js)
// ============================================================================

let currentChatId = null;
let isGenerating = false;

const DOM = {
    // 側邊欄
    sidebar: document.getElementById('sidebar'),
    chatList: document.getElementById('chat-list-items'),
    newChatBtn: document.getElementById('new-chat-btn'),
    hideSidebarBtn: document.getElementById('hide-sidebar-btn'),
    showSidebarBtn: document.getElementById('show-sidebar-btn'),
    openTrainingBtn: document.getElementById('open-training-btn'),
    openSettingsBtn: document.getElementById('open-settings-btn'),

    // 主對話視窗
    activeChatTitle: document.getElementById('active-chat-title'),
    messagesLog: document.getElementById('messages-log'),
    chatInput: document.getElementById('chat-input'),
    uploadFileTrigger: document.getElementById('upload-file-trigger'),
    chatFileInput: document.getElementById('chat-file-input'),
    quickGenBtn: document.getElementById('quick-gen-btn'),
    sendMsgBtn: document.getElementById('send-msg-btn'),
    sessionFileChips: document.getElementById('session-file-chips'),
    togglePreviewBtn: document.getElementById('toggle-preview-btn'),

    // A4 預覽側欄
    previewSidebar: document.getElementById('preview-sidebar'),
    copyDocBtn: document.getElementById('copy-doc-btn'),
    downloadWordBtn: document.getElementById('download-word-btn'),
    downloadDocBtn: document.getElementById('download-doc-btn'),
    printDocBtn: document.getElementById('print-doc-btn'),
    a4Sheet: document.getElementById('a4-sheet-view'),
    a4EmptyState: document.getElementById('a4-empty-state'),
    a4ContentWrapper: document.getElementById('a4-content-wrapper'),

    // A4 欄位
    docViewDept: document.getElementById('doc-view-dept'),
    docViewNum: document.getElementById('doc-view-num'),
    docViewDate: document.getElementById('doc-view-date'),
    docViewSecurity: document.getElementById('doc-view-security'),
    docViewSubject: document.getElementById('doc-view-subject'),
    docViewExplanation: document.getElementById('doc-view-explanation'),
    docViewProposal: document.getElementById('doc-view-proposal'),

    // 模組視窗 - 歷史公文庫
    trainingModal: document.getElementById('training-modal'),
    closeTrainingBtn: document.getElementById('close-training-btn'),
    closeTrainingFooterBtn: document.getElementById('close-training-footer-btn'),
    tplTitle: document.getElementById('tpl-title'),
    tplDocType: document.getElementById('tpl-doc-type'),
    
    // PDF 匯入元件
    tplIncomingPdfBtn: document.getElementById('upload-tpl-incoming-pdf-btn'),
    tplIncomingPdfFile: document.getElementById('tpl-incoming-pdf-file'),
    tplIncomingPdfStatus: document.getElementById('tpl-incoming-pdf-status'),
    
    tplDraftPdfBtn: document.getElementById('upload-tpl-draft-pdf-btn'),
    tplDraftPdfFile: document.getElementById('tpl-draft-pdf-file'),
    tplDraftPdfStatus: document.getElementById('tpl-draft-pdf-status'),
    
    // 附件上傳元件
    tplUploadAttachmentsBtn: document.getElementById('tpl-upload-attachments-btn'),
    tplAttachmentFileInput: document.getElementById('tpl-attachment-file-input'),
    tplAttachmentChips: document.getElementById('tpl-attachment-chips'),

    tplIncoming: document.getElementById('tpl-incoming'),
    tplDraft: document.getElementById('tpl-draft'),
    tplAttachments: document.getElementById('tpl-attachments'),
    saveTplBtn: document.getElementById('save-tpl-btn'),
    tplCount: document.getElementById('tpl-count'),
    tplListItems: document.getElementById('tpl-list-items'),

    // 模組視窗 - 設定
    settingsModal: document.getElementById('settings-modal'),
    closeSettingsBtn: document.getElementById('close-settings-btn'),
    cancelSettingsBtn: document.getElementById('cancel-settings-btn'),
    saveSettingsBtn: document.getElementById('save-settings-btn'),
    settingGeminiKey: document.getElementById('setting-gemini-key'),
    settingOpenaiKey: document.getElementById('setting-openai-key'),
    settingSysprompt: document.getElementById('setting-sysprompt'),

    // 通知
    toastBox: document.getElementById('toast-box')
};

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast-message ${type}`;

    let icon = '';
    if (type === 'success') {
        icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    } else {
        icon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    }

    toast.innerHTML = `${icon}<span>${message}</span>`;
    DOM.toastBox.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function init() {
    const chats = DB.getChats();
    if (chats.length === 0) {
        const defaultChat = DB.createChat('智慧公文簽辦助理啟動');
        currentChatId = defaultChat.id;
    } else {
        currentChatId = chats[0].id;
    }

    const settings = DB.getSettings();
    DOM.settingGeminiKey.value = settings.geminiApiKey || '';
    DOM.settingOpenaiKey.value = settings.openaiApiKey || '';
    DOM.settingSysprompt.value = settings.systemPrompt || '';

    bindEvents();

    renderSidebar();
    renderActiveChat();
    renderTrainingLibrary();
}

function bindEvents() {
    DOM.newChatBtn.addEventListener('click', () => {
        const newChat = DB.createChat();
        currentChatId = newChat.id;
        renderSidebar();
        renderActiveChat();
        DOM.chatInput.focus();
        showToast('新建公文簽辦對話');
    });

    DOM.hideSidebarBtn.addEventListener('click', () => {
        DOM.sidebar.classList.add('collapsed');
        DOM.showSidebarBtn.style.display = 'flex';
    });

    DOM.showSidebarBtn.addEventListener('click', () => {
        DOM.sidebar.classList.remove('collapsed');
        DOM.showSidebarBtn.style.display = 'none';
    });

    DOM.openTrainingBtn.addEventListener('click', () => {
        DOM.trainingModal.classList.add('active');
        renderTrainingLibrary();
    });

    DOM.closeTrainingBtn.addEventListener('click', () => DOM.trainingModal.classList.remove('active'));
    DOM.closeTrainingFooterBtn.addEventListener('click', () => DOM.trainingModal.classList.remove('active'));

    DOM.openSettingsBtn.addEventListener('click', () => {
        const settings = DB.getSettings();
        DOM.settingGeminiKey.value = settings.geminiApiKey || '';
        DOM.settingOpenaiKey.value = settings.openaiApiKey || '';
        DOM.settingSysprompt.value = settings.systemPrompt || '';
        DOM.settingsModal.classList.add('active');
    });

    DOM.closeSettingsBtn.addEventListener('click', () => DOM.settingsModal.classList.remove('active'));
    DOM.cancelSettingsBtn.addEventListener('click', () => DOM.settingsModal.classList.remove('active'));

    DOM.saveSettingsBtn.addEventListener('click', () => {
        const settings = {
            geminiApiKey: DOM.settingGeminiKey.value.trim(),
            openaiApiKey: DOM.settingOpenaiKey.value.trim(),
            systemPrompt: DOM.settingSysprompt.value.trim()
        };
        DB.saveSettings(settings);
        DOM.settingsModal.classList.remove('active');
        showToast('設定已成功儲存！');
        renderActiveChat();
    });

    DOM.saveTplBtn.addEventListener('click', handleSaveTrainingTemplate);

    DOM.togglePreviewBtn.addEventListener('click', () => {
        DOM.previewSidebar.classList.toggle('collapsed');
    });

    DOM.sendMsgBtn.addEventListener('click', handleSendMessage);
    DOM.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    DOM.quickGenBtn.addEventListener('click', () => {
        const currentText = DOM.chatInput.value.trim();
        if (!currentText) {
            DOM.chatInput.value = '請幫我簽辦今年度的採購智慧公文系統計畫，總預算編列新台幣150萬元整，預期在9月開始招標，擬同意辦理公開招標程序。';
            showToast('已預填經典公文案例，請點擊「生成公文」', 'success');
        } else {
            handleSendMessage();
        }
        DOM.chatInput.focus();
    });

    DOM.uploadFileTrigger.addEventListener('click', () => DOM.chatFileInput.click());
    DOM.chatFileInput.addEventListener('change', handleFileUpload);

    DOM.copyDocBtn.addEventListener('click', handleCopyDocument);
    DOM.downloadWordBtn.addEventListener('click', handleDownloadDocument);
    DOM.downloadDocBtn.addEventListener('click', handleDownloadPdf);
    DOM.printDocBtn.addEventListener('click', () => window.print());

    // 歷史公文庫 PDF 匯入與附件上傳綁定
    DOM.tplIncomingPdfBtn.addEventListener('click', () => DOM.tplIncomingPdfFile.click());
    DOM.tplIncomingPdfFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        parsePdfText(file, DOM.tplIncomingPdfStatus, DOM.tplIncoming);
        DOM.tplIncomingPdfFile.value = '';
    });

    DOM.tplDraftPdfBtn.addEventListener('click', () => DOM.tplDraftPdfFile.click());
    DOM.tplDraftPdfFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        parsePdfText(file, DOM.tplDraftPdfStatus, DOM.tplDraft);
        DOM.tplDraftPdfFile.value = '';
    });

    DOM.tplUploadAttachmentsBtn.addEventListener('click', () => DOM.tplAttachmentFileInput.click());
    DOM.tplAttachmentFileInput.addEventListener('change', handleTemplateAttachmentUpload);

    const editableFields = [
        DOM.docViewDept, DOM.docViewNum, DOM.docViewDate, DOM.docViewSecurity,
        DOM.docViewSubject, DOM.docViewExplanation, DOM.docViewProposal
    ];

    editableFields.forEach(field => {
        field.addEventListener('input', handleA4FieldEdit);
    });
}

function renderSidebar() {
    const chats = DB.getChats();
    DOM.chatList.innerHTML = '';

    chats.forEach(chat => {
        const isActive = chat.id === currentChatId;
        const chatItem = document.createElement('div');
        chatItem.className = `chat-item ${isActive ? 'active' : ''}`;
        chatItem.dataset.id = chat.id;

        chatItem.innerHTML = `
            <div class="chat-item-content">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                <span class="chat-item-text" id="chat-title-${chat.id}">${chat.title}</span>
            </div>
            <div class="chat-item-actions">
                <button class="chat-action-btn rename-btn" title="重新命名">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                </button>
                <button class="chat-action-btn delete-btn" title="刪除對話">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        `;

        chatItem.querySelector('.chat-item-content').addEventListener('click', () => {
            if (currentChatId === chat.id) return;
            currentChatId = chat.id;
            renderSidebar();
            renderActiveChat();
        });

        chatItem.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`確定要刪除「${chat.title}」對話嗎？`)) {
                const remaining = DB.deleteChat(chat.id);
                if (currentChatId === chat.id) {
                    currentChatId = remaining.length > 0 ? remaining[0].id : null;
                    if (!currentChatId) {
                        const defaultChat = DB.createChat();
                        currentChatId = defaultChat.id;
                    }
                }
                renderSidebar();
                renderActiveChat();
                showToast('對話已刪除', 'error');
            }
        });

        chatItem.querySelector('.rename-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const textSpan = document.getElementById(`chat-title-${chat.id}`);
            const currentTitle = textSpan.innerText;

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'chat-rename-input';
            input.value = currentTitle;

            textSpan.replaceWith(input);
            input.focus();
            input.select();

            const saveRename = () => {
                const newTitle = input.value.trim();
                if (newTitle && newTitle !== currentTitle) {
                    DB.renameChat(chat.id, newTitle);
                    renderSidebar();
                    if (chat.id === currentChatId) {
                        DOM.activeChatTitle.innerText = newTitle;
                    }
                    showToast('對話名稱已更新');
                } else {
                    renderSidebar();
                }
            };

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') saveRename();
                if (e.key === 'Escape') renderSidebar();
            });
            input.addEventListener('blur', saveRename);
        });

        DOM.chatList.appendChild(chatItem);
    });
}

function renderActiveChat() {
    const chats = DB.getChats();
    const activeChat = chats.find(c => c.id === currentChatId);

    if (!activeChat) return;

    DOM.activeChatTitle.innerText = activeChat.title;
    DOM.messagesLog.innerHTML = '';

    activeChat.messages.forEach(msg => {
        const messageRow = document.createElement('div');
        messageRow.className = `message-row ${msg.sender}-row`;

        let formattedText = msg.text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');

        let embeddedCard = '';
        if (msg.isDoc && msg.docData) {
            embeddedCard = `
                <div class="doc-card-embedded">
                    <div class="doc-card-info">
                        <svg class="doc-card-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                        <div>
                            <div class="doc-card-title">${msg.docData.dept || '秘書室'} - 簽辦公文草稿</div>
                            <div class="doc-card-size">發文字號: ${msg.docData.docNum}</div>
                        </div>
                    </div>
                    <button class="view-doc-btn" data-msg-id="${msg.id}">載入預覽</button>
                </div>
            `;
        }

        const today = new Date(msg.timestamp);
        const timeStr = `${today.getHours().toString().padStart(2, '0')}:${today.getMinutes().toString().padStart(2, '0')}`;

        messageRow.innerHTML = `
            <div class="message-bubble">
                <div>${formattedText}</div>
                ${embeddedCard}
                <span class="message-time">${timeStr}</span>
            </div>
        `;

        if (msg.isDoc && msg.docData) {
            messageRow.querySelector('.view-doc-btn').addEventListener('click', () => {
                loadDocumentToA4(msg.docData);
                DOM.previewSidebar.classList.remove('collapsed');
                showToast('已載入該公文至 A4 預覽面版');
            });
        }

        DOM.messagesLog.appendChild(messageRow);
    });

    DOM.messagesLog.scrollTop = DOM.messagesLog.scrollHeight;

    renderFileChips(activeChat.files || []);

    const docMessages = activeChat.messages.filter(m => m.isDoc && m.docData);
    if (docMessages.length > 0) {
        const latestDoc = docMessages[docMessages.length - 1].docData;
        loadDocumentToA4(latestDoc);
    } else {
        DOM.a4EmptyState.style.display = 'flex';
        DOM.a4ContentWrapper.style.display = 'none';
    }
}

function renderFileChips(files) {
    DOM.sessionFileChips.innerHTML = '';
    if (files.length === 0) return;

    files.forEach(file => {
        const chip = document.createElement('div');
        chip.className = 'file-chip';

        const sizeKB = Math.round(file.size / 1024);
        chip.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
            <span class="file-chip-name" title="${file.name}">${file.name} (${sizeKB} KB)</span>
            <button class="file-chip-remove" title="刪除檔案">&times;</button>
        `;

        chip.querySelector('.file-chip-remove').addEventListener('click', () => {
            DB.removeFileFromChat(currentChatId, file.name);
            renderActiveChat();
            showToast('已移除單次參考檔案', 'error');
        });

        DOM.sessionFileChips.appendChild(chip);
    });
}

function loadDocumentToA4(docData) {
    DOM.a4EmptyState.style.display = 'none';
    DOM.a4ContentWrapper.style.display = 'block';

    DOM.docViewDept.innerText = docData.dept || '秘書室';
    DOM.docViewNum.innerText = docData.docNum || '';
    DOM.docViewDate.innerText = docData.dateStr || '';
    DOM.docViewSecurity.innerText = docData.security || '普通 / 普通';
    DOM.docViewSubject.innerText = docData.subject || '';
    DOM.docViewExplanation.innerText = docData.explanation || '';
    DOM.docViewProposal.innerText = docData.proposal || '';
}

function renderTrainingLibrary() {
    const docs = DB.getTrainingDocs();
    DOM.tplCount.innerText = docs.length;
    DOM.tplListItems.innerHTML = '';

    if (docs.length === 0) {
        DOM.tplListItems.innerHTML = `<div class="disclaimer-text" style="padding: 20px;">訓練庫目前為空。請在上方上傳歷史簽辦資料！</div>`;
        return;
    }

    docs.forEach(doc => {
        const card = document.createElement('div');
        card.className = 'template-card';

        const date = new Date(doc.timestamp);
        const dateStr = `${date.getFullYear() - 1911}年${date.getMonth() + 1}月${date.getDate()}日`;

        const docTypeBadge = doc.docType ? `<span class="template-badge secondary" style="background: rgba(13, 148, 136, 0.15); color: var(--color-secondary); margin-left: 6px;">${doc.docType}</span>` : '';
        
        let attachmentChipsMarkup = '';
        if (doc.attachments && doc.attachments.length > 0) {
            attachmentChipsMarkup = `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-top:6px;">`;
            doc.attachments.forEach(att => {
                attachmentChipsMarkup += `
                    <span class="file-chip" style="font-size:10px; padding:2px 8px; margin:0; pointer-events:none;">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                        ${att.name}
                    </span>
                `;
            });
            attachmentChipsMarkup += `</div>`;
        }

        card.innerHTML = `
            <div class="template-card-header">
                <div class="template-card-title">${doc.title}</div>
                <div class="template-card-actions">
                    <button class="chat-action-btn delete-btn" title="從訓練庫刪除">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </div>
            <div class="template-snippet"><strong>歷史來文:</strong> ${doc.incomingText.substring(0, 80)}...</div>
            ${attachmentChipsMarkup}
            <div class="template-meta" style="margin-top: 8px;">
                <span class="template-badge">訓練樣本</span>
                ${docTypeBadge}
                <span>上傳日期: 中華民國${dateStr}</span>
            </div>
        `;

        card.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation(); // CRITICAL: Stop event bubbling!
            if (confirm(`確定要從永久訓練庫刪除「${doc.title}」嗎？`)) {
                DB.deleteTrainingDoc(doc.id);
                renderTrainingLibrary();
                showToast('歷史公文已從訓練庫移除', 'error');
            }
        });

        card.addEventListener('click', (e) => {
            if (e.target.closest('.chat-action-btn')) return;
            DOM.tplTitle.value = doc.title;
            DOM.tplDocType.value = doc.docType || '簽';
            DOM.tplIncoming.value = doc.incomingText;
            DOM.tplDraft.value = doc.draftText;
            DOM.tplAttachments.value = doc.attachmentDesc || '';
            
            // Load attachments into temporary editing array
            tempTemplateAttachments = doc.attachments ? [...doc.attachments] : [];
            renderTempTemplateAttachments();
            
            showToast('已載入該範本內容至上方編輯表單');
        });

        DOM.tplListItems.appendChild(card);
    });
}

function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const maxSizeBytes = 5 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
        showToast('檔案大小超過 5MB 限制！', 'error');
        return;
    }

    const reader = new FileReader();

    if (file.type.startsWith('text/') || file.name.endsWith('.txt')) {
        reader.onload = function (evt) {
            const fileObj = {
                name: file.name,
                size: file.size,
                type: file.type || 'text/plain',
                content: evt.target.result
            };
            DB.addFileToChat(currentChatId, fileObj);
            renderActiveChat();
            showToast(`已成功上傳來文檔案「${file.name}」！`);
        };
        reader.readAsText(file);
    } else {
        const fileObj = {
            name: file.name,
            size: file.size,
            type: file.type || 'application/octet-stream',
            content: `[這是一份二進制附件檔案: ${file.name}]`
        };
        DB.addFileToChat(currentChatId, fileObj);
        renderActiveChat();
        showToast(`已成功上傳附件檔案「${file.name}」！`);
    }

    DOM.chatFileInput.value = '';
}

function handleSaveTrainingTemplate() {
    const title = DOM.tplTitle.value.trim();
    const docType = DOM.tplDocType.value;
    const incoming = DOM.tplIncoming.value.trim();
    const draft = DOM.tplDraft.value.trim();
    let attachmentDescText = DOM.tplAttachments.value.trim();

    if (!title || !incoming || !draft) {
        showToast('範本名稱、歷史來文及簽辦公文草稿均為必填！', 'error');
        return;
    }

    if (tempTemplateAttachments.length > 0) {
        const fileLines = tempTemplateAttachments.map((f, i) => `${i + 1}. 附件檔案: ${f.name}`).join('\n');
        attachmentDescText = attachmentDescText ? `${attachmentDescText}\n${fileLines}` : fileLines;
    }

    DB.addTrainingDoc({
        title,
        docType,
        incomingText: incoming,
        draftText: draft,
        attachmentDesc: attachmentDescText,
        attachments: tempTemplateAttachments
    });

    DOM.tplTitle.value = '';
    DOM.tplIncoming.value = '';
    DOM.tplDraft.value = '';
    DOM.tplAttachments.value = '';
    
    // 重設 PDF 解析狀態與上傳附件狀態
    DOM.tplIncomingPdfStatus.innerText = '';
    DOM.tplDraftPdfStatus.innerText = '';
    tempTemplateAttachments = [];
    renderTempTemplateAttachments();

    renderTrainingLibrary();
    showToast('成功上傳永久歷史公文範本，AI已完成格式訓練！', 'success');
}

async function handleSendMessage() {
    if (isGenerating) return;

    const userText = DOM.chatInput.value.trim();
    const chats = DB.getChats();
    const activeChat = chats.find(c => c.id === currentChatId);

    if (!userText && (!activeChat.files || activeChat.files.length === 0)) {
        showToast('請先輸入本次來文說明或上傳簽辦檔案！', 'error');
        return;
    }

    let displayUserText = userText;
    if (activeChat.files && activeChat.files.length > 0) {
        const fileListStr = activeChat.files.map(f => `📄【${f.name}】`).join('\n');
        displayUserText = userText ? `${userText}\n\n[附帶檔案]：\n${fileListStr}` : `已提供簽辦參考檔案：\n${fileListStr}`;
    }

    DB.addMessage(currentChatId, {
        sender: 'user',
        text: displayUserText
    });

    DOM.chatInput.value = '';
    renderActiveChat();

    isGenerating = true;
    DOM.sendMsgBtn.disabled = true;

    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'message-row assistant-row';
    typingIndicator.id = 'msg-generating-loading';
    typingIndicator.innerHTML = `
        <div class="typing-indicator">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span style="font-size:12px; color:var(--text-secondary); margin-left:6px;">AI 正在分析永久公文庫並撰寫草稿中...</span>
        </div>
    `;
    DOM.messagesLog.appendChild(typingIndicator);
    DOM.messagesLog.scrollTop = DOM.messagesLog.scrollHeight;

    try {
        const result = await Generator.generate(userText || "請依據上傳檔案簽辦公文", activeChat.files);

        const loader = document.getElementById('msg-generating-loading');
        if (loader) loader.remove();

        DB.addMessage(currentChatId, {
            sender: 'assistant',
            text: `已參考您的「永久歷史公文庫」格式與「單次簽辦檔案」，為您成功擬具本次公文**「簽」**的草稿。相關格式已自動渲染至右側 A4 面版中。\n\n您可以直接在右側進行「即時點擊編輯」與修正，確認無誤後即可進行複製、下載或列印輸出。`,
            isDoc: true,
            docData: result.docData
        });

        if (activeChat.title === '新公文對話' || activeChat.title === '智慧公文簽辦助理啟動') {
            const shortTitle = result.docData.subject ? result.docData.subject.substring(0, 12).replace(/^關於/, '') + '案' : '新公文對話';
            DB.renameChat(currentChatId, shortTitle);
        }

        renderSidebar();
        renderActiveChat();

        DOM.previewSidebar.classList.remove('collapsed');
        showToast('公文草稿已生成，即時渲染至 A4 面版！', 'success');

    } catch (e) {
        console.error('公文生成失敗:', e);

        const loader = document.getElementById('msg-generating-loading');
        if (loader) loader.remove();

        DB.addMessage(currentChatId, {
            sender: 'assistant',
            text: `❌ **公文生成失敗**\n\n原因: ${e.message}\n\n請至左下角「金鑰與系統設定」確認您的 API Key 是否正確且有效。在未填寫 API Key 的情況下，系統亦支援穩定的離線智慧模板公文合成。`
        });

        renderActiveChat();
        showToast('生成出錯，請檢視 API Key 設定', 'error');
    } finally {
        isGenerating = false;
        DOM.sendMsgBtn.disabled = false;
    }
}

function handleA4FieldEdit() {
    const chats = DB.getChats();
    const activeChat = chats.find(c => c.id === currentChatId);
    if (!activeChat) return;

    const assistantMessages = activeChat.messages.filter(m => m.sender === 'assistant' && m.isDoc && m.docData);
    if (assistantMessages.length === 0) return;

    const lastMsg = assistantMessages[assistantMessages.length - 1];

    lastMsg.docData.dept = DOM.docViewDept.innerText.trim();
    lastMsg.docData.docNum = DOM.docViewNum.innerText.trim();
    lastMsg.docData.dateStr = DOM.docViewDate.innerText.trim();
    lastMsg.docData.security = DOM.docViewSecurity.innerText.trim();
    lastMsg.docData.subject = DOM.docViewSubject.innerText.trim();
    lastMsg.docData.explanation = DOM.docViewExplanation.innerText;
    lastMsg.docData.proposal = DOM.docViewProposal.innerText;

    DB.saveChats(chats);
}

function handleCopyDocument() {
    const dept = DOM.docViewDept.innerText.trim();
    const num = DOM.docViewNum.innerText.trim();
    const date = DOM.docViewDate.innerText.trim();
    const security = DOM.docViewSecurity.innerText.trim();
    const subject = DOM.docViewSubject.innerText.trim();
    const explanation = DOM.docViewExplanation.innerText.trim();
    const proposal = DOM.docViewProposal.innerText.trim();

    if (!subject) {
        showToast('目前尚無可複製的公文內容！', 'error');
        return;
    }

    const fullText = `機關：${dept}
文號：${num}
日期：${date}
密等及解密條件：${security}

主旨：
${subject}

說明：
${explanation}

擬辦：
${proposal}`;

    navigator.clipboard.writeText(fullText)
        .then(() => showToast('公文文字已複製到剪貼簿！'))
        .catch(err => {
            console.error('複製失敗:', err);
            showToast('複製失敗，請手動全選複製', 'error');
        });
}

function handleDownloadDocument() {
    const dept = DOM.docViewDept.innerText.trim();
    const num = DOM.docViewNum.innerText.trim();
    const date = DOM.docViewDate.innerText.trim();
    const security = DOM.docViewSecurity.innerText.trim();
    const subject = DOM.docViewSubject.innerText.trim();
    const explanation = DOM.docViewExplanation.innerText.trim();
    const proposal = DOM.docViewProposal.innerText.trim();

    if (!subject) {
        showToast('目前尚無可下載的公文內容！', 'error');
        return;
    }

    const htmlContent = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
        <title>公文簽辦草稿</title>
        <style>
            body { font-family: "SimSun", "Noto Sans TC", serif; line-height: 1.8; padding: 20px; }
            h1 { text-align: center; color: #dc2626; letter-spacing: 0.3em; border-bottom: 2px double #dc2626; padding-bottom: 10px; }
            .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; border-bottom: 1px solid #000; }
            .meta-table td { padding: 8px; font-size: 12pt; }
            .section-title { font-weight: bold; font-size: 14pt; margin-top: 15px; margin-bottom: 5px; }
            .section-content { white-space: pre-wrap; font-size: 12pt; padding-left: 20px; margin-bottom: 15px; }
        </style>
    </head>
    <body>
        <h1>簽</h1>
        <table class="meta-table">
            <tr>
                <td><b>機關單位：</b>${dept}</td>
                <td><b>發文字號：</b>${num}</td>
            </tr>
            <tr>
                <td><b>簽辦日期：</b>${date}</td>
                <td><b>密等速別：</b>${security}</td>
            </tr>
        </table>
        
        <div class="section-title">【主旨】</div>
        <div class="section-content">${subject}</div>
        
        <div class="section-title">【說明】</div>
        <div class="section-content">${explanation}</div>
        
        <div class="section-title">【擬辦】</div>
        <div class="section-content">${proposal}</div>
    </body>
    </html>
    `;

    const blob = new Blob(['\ufeff' + htmlContent], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${dept}_簽辦草稿_${num}.doc`;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);

    showToast('Word 公文檔案已成功下載！');
}

// ============================================================================
// 4. 歷史公文庫擴充助手與 A4 高仿真 PDF 下載 (新增 helper 函數)
// ============================================================================

let tempTemplateAttachments = [];

function renderTempTemplateAttachments() {
    DOM.tplAttachmentChips.innerHTML = '';
    tempTemplateAttachments.forEach((file, index) => {
        const chip = document.createElement('div');
        chip.className = 'file-chip';
        const sizeKB = Math.round(file.size / 1024);
        chip.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
            <span class="file-chip-name" title="${file.name}">${file.name} (${sizeKB} KB)</span>
            <button class="file-chip-remove" type="button" data-index="${index}">&times;</button>
        `;
        chip.querySelector('.file-chip-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            tempTemplateAttachments.splice(index, 1);
            renderTempTemplateAttachments();
            showToast('已移除附件檔案', 'error');
        });
        DOM.tplAttachmentChips.appendChild(chip);
    });
}

function handleTemplateAttachmentUpload(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    files.forEach(file => {
        const maxSizeBytes = 10 * 1024 * 1024; // 10MB limit
        if (file.size > maxSizeBytes) {
            showToast(`檔案「${file.name}」超過 10MB 大小限制！`, 'error');
            return;
        }
        
        const reader = new FileReader();
        
        if (file.type.startsWith('image/')) {
            reader.onload = function(evt) {
                tempTemplateAttachments.push({
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    content: evt.target.result // Base64
                });
                renderTempTemplateAttachments();
            };
            reader.readAsDataURL(file);
        } else {
            reader.onload = function(evt) {
                tempTemplateAttachments.push({
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    content: `[附件內容檔案: ${file.name}]`
                });
                renderTempTemplateAttachments();
            };
            reader.readAsText(file);
        }
    });
    
    DOM.tplAttachmentFileInput.value = '';
    showToast(`已成功載入 ${files.length} 個附件至快取！`);
}

async function parsePdfText(file, statusElement, textareaElement) {
    statusElement.innerText = '讀取中...';
    statusElement.style.color = 'var(--color-primary)';
    
    try {
        const arrayBuffer = await file.arrayBuffer();
        
        if (!window.pdfjsLib) {
            throw new Error('PDF.js 解析庫尚未完全載入！');
        }
        
        // 指定 PDF.js 的 Worker 執行緒以獲取最快載入速度與非阻塞 UI
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
        
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        let fullText = '';
        
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
        }
        
        if (!fullText.trim()) {
            throw new Error('PDF 未萃取出文字（可能為非電子文字之手寫/掃描影像檔）');
        }
        
        textareaElement.value = fullText.trim();
        statusElement.innerText = 'PDF 匯入成功！';
        statusElement.style.color = 'var(--color-success)';
        showToast('已從 PDF 成功提取並匯入公文內容文字！');
        
    } catch (e) {
        console.error('PDF 匯入失敗:', e);
        statusElement.innerText = '解析失敗';
        statusElement.style.color = 'var(--color-danger)';
        showToast(`PDF 匯入失敗: ${e.message}`, 'error');
    }
}

function handleDownloadPdf() {
    const dept = DOM.docViewDept.innerText.trim();
    const num = DOM.docViewNum.innerText.trim();
    const subject = DOM.docViewSubject.innerText.trim();

    if (!subject) {
        showToast('目前尚無可供下載的公文內容！', 'error');
        return;
    }

    const element = DOM.a4Sheet;
    
    // 設定 html2pdf 配置以確保完美輸出標準 A4 高擬真 PDF 排版
    const opt = {
        margin:       15,
        filename:     `${dept}_簽辦草稿_${num}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, letterRendering: true },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    showToast('正在產生 PDF 公文檔案...', 'success');
    
    html2pdf().set(opt).from(element).save()
        .then(() => {
            showToast('PDF 公文檔案已成功下載！');
        })
        .catch(err => {
            console.error('PDF 下載失敗:', err);
            showToast('PDF 產生失敗，請改用系統「列印」儲存為 PDF。', 'error');
        });
}

window.addEventListener('DOMContentLoaded', init);
