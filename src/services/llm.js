const { GoogleGenerativeAI } = require('@google/generative-ai');

class LLMService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
  }

  async generateEpisodeContent(episodeData) {
    try {
      // 步驟1: 生成10個標題候選
      const titles = await this.generateTitleCandidates(episodeData.emailHtml);
      
      // 步驟2: 選擇最佳標題
      const bestTitle = await this.selectBestTitle(titles, episodeData.emailHtml);
      
      // 步驟3: 生成描述
      const description = await this.generateDescription(episodeData.emailHtml);
      
      return {
        title: bestTitle,
        description: description,
        titleCandidates: titles // 保留所有候選標題供參考
      };
    } catch (error) {
      console.error('LLM 生成內容失敗:', error);
      return {
        title: episodeData.title || '未命名集數',
        description: episodeData.emailHtml || '暫無描述'
      };
    }
  }

  async generateTitleCandidates(emailHtml) {
    const titleExamples = [
      "AI 幫你找創業題目、寫網站、還能自動除錯！這些工具太狂了吧！",
      "AI 副業爆發中！從開店到頻道複製，每月賺 50K 的祕密都在這",
      "Google 搜尋大改版！網站流量全崩？Claude 代理人來救場"
    ];

    const prompt = `
請基於以下 Email HTML 內容，生成 10 個超級吸引人的中文 Podcast 標題：

內容：
${emailHtml}

參考標題範例（風格和語調）：
${titleExamples.map((example, index) => `${index + 1}. ${example}`).join('\n')}

**最佳標題的黃金法則**：
🎯 **賺錢吸引力**：暗示能幫助用戶賺錢、提升收入、創造商機
🎯 **顛覆想像**：突出前所未見的功能、革命性的改變、史無前例的能力
🎯 **效率躍進**：強調大幅提升效率、省時省力、自動化革命
🎯 **新工具名稱**：必須在標題中明確提到具體的AI工具名稱
🎯 **獨家祕密**：用詞要讓人感覺獲得內部消息、獨家技巧

標題撰寫要求：
1. 必須是繁體中文標題
2. 每個標題不超過 50 字
3. **必須包含具體的AI工具名稱**（如：YouWare、Claude、Trae AI、Cursor等）
4. 使用強力吸引詞彙：
   - 賺錢相關：「月賺50K」、「躺著賺錢」、「暴富祕密」、「財富密碼」
   - 顛覆相關：「史上最強」、「前所未見」、「顛覆想像」、「突破極限」
   - 效率相關：「效率暴增」、「秒速完成」、「10倍效率」、「自動化革命」
   - 獨家相關：「內幕大公開」、「獨家祕技」、「業界震撼」、「首度曝光」
5. 語調要震撼、誇張但真實
6. **絕對不要使用任何 emoji 或表情符號**
7. **只能使用純文字、標點符號**

請以編號列表格式回覆，每行一個中文標題：
1. 標題一
2. 標題二
...
`;

    const result = await this.model.generateContent(prompt);
    const response = await result.response;
    return this.parseTitleCandidates(response.text());
  }  async selectBestTitle(titles, emailHtml) {
    const prompt = `
以下是 10 個 Podcast 標題候選：

${titles.map((title, index) => `${index + 1}. ${title}`).join('\n')}

原始內容摘要：
${emailHtml.substring(0, 500)}...

請選擇最適合的標題，優先考慮因素：
1. **最有賺錢潛力**：能讓聽眾感覺可以賺錢或提升收入的標題
2. **最顛覆想像**：突出前所未見、革命性的AI功能
3. **最大效率提升**：強調大幅效率提升、自動化革命的標題
4. **包含具體工具名稱**：明確提到AI工具名稱的標題優先
5. **最震撼的用詞**：使用「史上最強」、「業界震撼」、「內幕大公開」等詞彙
6. 準確反映內容且適合目標聽眾（對 AI 工具感興趣的人）

請只回覆選中的標題編號和標題內容，格式：
選擇：3
標題：具體標題內容
`;

    const result = await this.model.generateContent(prompt);
    const response = await result.response;
    return this.parseBestTitle(response.text(), titles);
  }

  async generateDescription(emailHtml) {
    const exampleDescription = `從找創業點子到打造 App，全都交給 AI！今天幫你精選 5 支熱門 AI 工具影片，讓寫程式變得跟玩一樣簡單 🚀

💡 YouWare：免寫程式做網站，AI 寫前端快到炸！

 👉 全自動 No-Code 開發平台，拖拉元件就能生成網站，還送 VIP 福利！

💡 Claude + Reddit 金礦挖掘法：45 分鐘找到百萬創業點子

 👉 結合 AI 與市場數據，一鍵產出 Landing Page，幫你測試商業模式。

💡 Claude Code：2025 最簡單寫 App 的方式登場！

 👉 用 Claude 設計 UI、寫邏輯、解 Bug，寫 App 比手遊還簡單。

💡 Trae AI：完全免費的 AI IDE，寫程式體驗直接升級！

 👉 自動補全、模組推薦、Bug 偵測通通內建，初學者友好到不行。

💡 Cursor IDE 更新：BugBot、MCP 安裝一鍵搞定！

 👉 新增智慧代理人與模組市場，程式設計自動化再進化！

留言告訴我你對這一集的想法： https://open.firstory.me/user/cmay8xsor005301wpfp40apg1/comments`;    const prompt = `
請基於以下 Email HTML 內容，生成一個 Podcast 描述：

內容：
${emailHtml}

參考格式範例：
${exampleDescription}

要求：
1. 開頭要有一個吸引人的總結句（1-2句話）
2. 使用 💡 符號標示每個重點工具或話題
3. 每個重點包含：
   - 工具/話題名稱
   - 簡短描述（用 👉 開頭）
4. 保持活潑有趣的語調
5. 加入適當的 emoji
6. 最後加上留言呼籲：留言告訴我你對這一集的想法： https://open.firstory.me/user/cmay8xsor005301wpfp40apg1/comments

總字數控制在 200-400 字之間。
`;

    const result = await this.model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  }

  parseTitleCandidates(content) {
    try {
      const lines = content.split('\n').filter(line => line.trim());
      const titles = [];
      
      for (const line of lines) {
        // 匹配 "1. 標題" 或 "1) 標題" 格式
        const match = line.match(/^\d+[\.\)]\s*(.+)$/);
        if (match) {
          titles.push(match[1].trim());
        }
      }
      
      return titles.length >= 5 ? titles : ['預設標題1', '預設標題2', '預設標題3'];
    } catch (error) {
      console.error('解析標題候選失敗:', error);
      return ['預設標題1', '預設標題2', '預設標題3'];
    }
  }  parseBestTitle(content, titles) {
    try {
      // 尋找選擇的編號
      const choiceMatch = content.match(/選擇[：:]\s*(\d+)/);
      // 或者尋找標題內容
      const titleMatch = content.match(/標題[：:]\s*(.+)/);
      
      if (choiceMatch) {
        const index = parseInt(choiceMatch[1]) - 1;
        if (index >= 0 && index < titles.length) {
          return titles[index];
        }
      }
      
      if (titleMatch) {
        return titleMatch[1].trim();
      }
      
      // 預設返回第一個標題
      return titles[0] || '預設標題';
    } catch (error) {
      console.error('解析最佳標題失敗:', error);
      return titles[0] || '預設標題';
    }
  }
}

module.exports = { LLMService };