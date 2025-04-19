const { Sequelize, DataTypes } = require('sequelize');

// Khởi tạo kết nối database
const path = require('path');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.resolve(__dirname, '../db/app.db'),
  logging: false
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