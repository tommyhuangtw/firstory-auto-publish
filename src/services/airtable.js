const Airtable = require('airtable');
const { ContentGenerator } = require('./contentGenerator');
const { APPENDED_TEXT, APPENDED_TEXT2 } = require('../utils/flowHelpers');

class AirtableService {
  constructor() {
    this.base = new Airtable({
      apiKey: process.env.AIRTABLE_API_KEY
    }).base(process.env.AIRTABLE_BASE_ID);
    this.tableName = 'Daily Podcast Summary'; // 直接指定表格名稱
    this.contentGenerator = new ContentGenerator();
  }

  async getRecordsToUpload() {
    try {
      const records = await this.base(this.tableName).select({
        sort: [{ field: 'Date', direction: 'desc' }],
        maxRecords: 5
      }).firstPage();

      return records.map(record => ({
        id: record.id,
        title: record.get('Youtube Title1') || record.get('Title') || record.get('Podcast Title'),
        content: record.get('Raw Podcast Summary') || record.get('Content') || record.get('Summary'),
        description: record.get('Raw Podcast Summary') || record.get('Content') || record.get('Summary'),
        emailHtml: record.get('Email html'),
        audioFileId: record.get('Audio File ID'),
        coverImageId: record.get('Cover Image ID'),
        episodeNumber: record.get('Episode Number'),
        tags: record.get('Tags'),
        scheduledDate: record.get('Scheduled Date'),
        podcastLink: record.get('Podcast Link'),
        youtubeLink: record.get('Youtube Link1'),
        status: record.get('Upload Status') || record.get('Status') || 'Pending',
        date: record.get('Date')
      }));
    } catch (error) {
      console.error('從 Airtable 獲取資料失敗:', error);
      throw error;
    }
  }

  async getNextEpisodeToUpload() {
    try {
      const records = await this.base(this.tableName).select({
        sort: [{ field: 'Date', direction: 'desc' }],
        maxRecords: 1
      }).firstPage();

      if (records.length === 0) {
        return null;
      }

      const record = records[0];
      return {
        id: record.id,
        title: record.get('Youtube Title1') || record.get('Title'),
        content: record.get('Raw Podcast Summary') || record.get('Content'),
        emailHtml: record.get('Email html'),
        audioFileId: record.get('Audio File ID'),
        coverImageId: record.get('Cover Image ID'),
        episodeNumber: record.get('Episode Number'),
        tags: record.get('Tags'),
        scheduledDate: record.get('Scheduled Date'),
        podcastLink: record.get('Podcast Link'),
        youtubeLink: record.get('Youtube Link1')
      };
    } catch (error) {
      console.error('從 Airtable 獲取資料失敗:', error);
      throw error;
    }
  }

  async updateRecordStatus(recordId, status) {
    try {
      const updateData = {
        'Status': status,
        'Last Updated': new Date().toISOString()
      };

      if (status.includes('Uploaded')) {
        updateData['Upload Date'] = new Date().toISOString();
        updateData['Upload Status'] = 'Success';
      }

      await this.base(this.tableName).update(recordId, updateData);
      console.log(`Record ${recordId} 狀態已更新為: ${status}`);
    } catch (error) {
      console.error('更新 Airtable 狀態失敗:', error);
      throw error;
    }
  }

  async markEpisodeAsUploaded(recordId) {
    try {
      await this.base(this.tableName).update(recordId, {
        'Status': 'Uploaded',
        'Upload Date': new Date().toISOString(),
        'Upload Status': 'Success'
      });
      console.log(`Episode ${recordId} 標記為已上傳`);
    } catch (error) {
      console.error('更新 Airtable 狀態失敗:', error);
      throw error;
    }
  }

  async updateEpisodeStatus(recordId, status, error = null) {
    try {
      const updateData = {
        'Status': status,
        'Last Updated': new Date().toISOString()
      };

      if (error) {
        updateData['Error Message'] = error;
      }

      await this.base(this.tableName).update(recordId, updateData);
    } catch (err) {
      console.error('更新狀態失敗:', err);
    }
  }

  async getLatestEpisodeContent(segment = null) {
    try {
      console.log('📊 從 Airtable 獲取最新單集內容...');
      console.log(`🔍 連接到表格: ${this.tableName}`);
      
      const records = await this.base(this.tableName).select({
        sort: [{ field: 'Date', direction: 'desc' }],
        maxRecords: 1,
        filterByFormula: `NOT({Email html} = '')` // 修正欄位名稱
      }).firstPage();

      if (records.length === 0) {
        throw new Error('沒有找到包含 Email html 的記錄');
      }

      const record = records[0];
      const emailHtml = record.get('Email html'); // 修正欄位名稱
      
      if (!emailHtml) {
        throw new Error('Email html 欄位為空');
      }

      console.log('✅ 找到最新記錄，開始生成標題和描述...');
      console.log(`📄 Email html 長度: ${emailHtml.length} 字元`);
      
      // 使用 ContentGenerator 生成標題和描述
      const generatedContent = await this.contentGenerator.generateFromEmailHtml(emailHtml, segment);

      return {
        recordId: record.id,
        title: generatedContent.title,
        titles: generatedContent.titles,
        bestTitleIndex: generatedContent.bestTitleIndex,
        description: APPENDED_TEXT + generatedContent.description + APPENDED_TEXT2,
        tags: generatedContent.tags,
        originalEmailHtml: emailHtml,
        date: record.get('Date'),
        rawContent: record.get('Raw Podcast Summary Raw') || '', // 可能的備用欄位
        status: record.get('Status') || 'Pending'
      };
      
    } catch (error) {
      console.error('❌ 從 Airtable 獲取內容失敗:', error.message);
      throw error;
    }
  }

  // AI 生成邏輯已移至 ContentGenerator (src/services/contentGenerator.js)
}

module.exports = { AirtableService };