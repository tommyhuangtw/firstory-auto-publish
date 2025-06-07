const Airtable = require('airtable');

class AirtableService {
  constructor() {
    this.base = new Airtable({
      apiKey: process.env.AIRTABLE_API_KEY
    }).base(process.env.AIRTABLE_BASE_ID);
    this.tableName = process.env.AIRTABLE_TABLE_NAME || 'Podcast Episodes';
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

  async markEpisodeAsUploaded(recordId) {
    try {
      // 只更新確定存在的欄位
      const updateData = {
        'Upload Date': new Date().toISOString(),
      };
      
      // 嘗試更新 Upload Status，如果不存在就跳過
      try {
        await this.base(this.tableName).update(recordId, {
          ...updateData,
          'Upload Status': 'Success'
        });
      } catch (error) {
        // 如果 Upload Status 欄位不存在，只更新 Upload Date
        await this.base(this.tableName).update(recordId, updateData);
      }
      
      console.log(`Episode ${recordId} 標記為已上傳`);
    } catch (error) {
      console.error('更新 Airtable 狀態失敗:', error);
      // 不要拋出錯誤，讓程序繼續執行
      console.log('⚠️  Airtable 更新失敗，但不影響上傳結果');
    }
  }

  async updateEpisodeStatus(recordId, status, error = null) {
    try {
      const updateData = {
        'Last Updated': new Date().toISOString()
      };

      if (error) {
        updateData['Error Message'] = error;
      }

      // 嘗試更新，如果欄位不存在就跳過
      try {
        await this.base(this.tableName).update(recordId, updateData);
      } catch (err) {
        console.log('⚠️  某些 Airtable 欄位不存在，跳過更新');
      }
    } catch (err) {
      console.error('更新狀態失敗:', err);
      // 不拋出錯誤，避免中斷主流程
    }
  }
}

module.exports = { AirtableService };