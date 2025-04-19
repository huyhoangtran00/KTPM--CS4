const { Sequelize, DataTypes } = require('sequelize');

// Khởi tạo kết nối database với PostgreSQL
const sequelize = new Sequelize('cs4', 'postgres', '12344321', {
  host: 'localhost', // hoặc host của bạn
  dialect: 'postgres',
  logging: false // Tắt log query (bật khi debug nếu cần)
});

// Định nghĩa model Data
const Data = sequelize.define('Data', {
  keyID: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true
  },
  value: {
    type: DataTypes.TEXT,
    allowNull: false
  }
}, {
  tableName: 'data',
  timestamps: false // Không sử dụng createdAt và updatedAt
});

// Đồng bộ hóa model với database
sequelize.sync()
  .then(() => console.log('Database & tables synced!'))
  .catch(err => console.error('Error syncing database:', err));

module.exports = Data;
