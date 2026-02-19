import knex from 'knex';

// Import oracledb for Thick mode initialization
const oracledb = require("oracledb");

// ตัวแปรเก็บสถานะว่า Oracle Thick mode ถูก initialize แล้วหรือยัง
let oracleThickModeInitialized = false;

/**
 * Initialize Oracle Client สำหรับ Thick mode
 * ต้องเรียกก่อนสร้าง connection ครั้งแรก
 */
const initOracleThickMode = () => {
  if (oracleThickModeInitialized) {
    return;
  }

  try {
    const libDir = process.env.ORACLE_CLIENT_LIB_DIR || undefined;
    const configDir = process.env.ORACLE_CLIENT_CONFIG_DIR || undefined;
    
    // กำหนด options สำหรับ initOracleClient
    const initOptions: any = {};
    if (libDir) {
      initOptions.libDir = libDir;
    }
    if (configDir) {
      initOptions.configDir = configDir;
    }
    
    // เรียก initOracleClient
    if (Object.keys(initOptions).length > 0) {
      oracledb.initOracleClient(initOptions);
    } else {
      oracledb.initOracleClient();
    }
    
    oracleThickModeInitialized = true;
    console.log('✅ Oracle Thick mode initialized successfully');
    if (libDir) {
      console.log(`   📁 Library directory: ${libDir}`);
    }
    if (configDir) {
      console.log(`   📄 Config directory: ${configDir}`);
    }
  } catch (err: any) {
    if (err.message.includes('already been initialized')) {
      oracleThickModeInitialized = true;
      console.log('⚠️  Oracle Thick mode already initialized');
    } else {
      console.error('❌ Failed to initialize Oracle Thick mode:', err.message);
      console.error('   💡 Tip: Make sure Oracle Instant Client is installed');
      console.error('   💡 Tip: Set ORACLE_CLIENT_LIB_DIR environment variable');
      throw err;
    }
  }
};

var timezone = 'Asia/Bangkok';
var options = {
  HIS: {
    client: process.env.HIS_DB_CLIENT || 'mysql2',
    connection: {
      host: process.env.HIS_DB_HOST,
      user: process.env.HIS_DB_USER,
      password: process.env.HIS_DB_PASSWORD,
      database: process.env.HIS_DB_NAME,
      port: +process.env.HIS_DB_PORT || 3306,
      charset: process.env.HIS_DB_CHARSET || null,
      schema: process.env.HIS_DB_SCHEMA || 'public',
      encrypt: process.env.HIS_DB_ENCRYPT || null,
      timezone
    }
  },
  ISONLINE: {
    client: process.env.IS_DB_CLIENT || 'mysql',
    connection: {
      host: process.env.IS_DB_HOST,
      user: process.env.IS_DB_USER,
      password: process.env.IS_DB_PASSWORD,
      database: process.env.IS_DB_NAME || 'isdb',
      port: +process.env.IS_DB_PORT || 3306,
      charset: process.env.IS_DB_CHARSET || null,
      schema: process.env.IS_DB_SCHEMA,
      encrypt: process.env.IS_DB_ENCRYPT || true,
      timezone
    }
  }
};

const dbConnection = (type = 'HIS') => {
  type = type.toUpperCase();

  const config: any = options[type];
  const connection: any = config.connection;
  config.client = config.client ? config.client.toLowerCase() : 'mysql2';

  let opt: any = {};
  
  if (config.client == 'mssql') {
    opt = {
      client: config.client,
      connection: {
        server: connection.host,
        user: connection.user,
        password: connection.password,
        database: connection.database,
        options: {
          port: +connection.port,
          schema: connection.schema,
          trustServerCertificate: connection?.trustServerCertificate !== false
        }
      }
    };
    if (connection?.encrypt) {
      opt.connection.encrypt = connection?.encrypt === false ? false : 'strict';
    }
  } else if (config.client == 'oracledb') {
    // กำหนด driver mode: 'thin' (default) หรือ 'thick'
    const driverMode = (
      process.env.NODE_ORACLEDB_DRIVER_MODE || 
      process.env.DB_ORACLEDB_DRIVER_MODE || 
      'thin'
    ).toLowerCase();

    // ถ้าเป็น thick mode ให้ initialize Oracle Client
    if (driverMode === 'thick') {
      console.log('🔧 Using Oracle Thick mode...');
      initOracleThickMode();
    } else {
      console.log('⚡ Using Oracle Thin mode (no client libraries needed)');
    }

    // สร้าง connection string
    const port = connection.port || 1521;
    const connectString = `${connection.host}:${port}/${connection.database}`;

    opt = {
      client: 'oracledb',
      connection: {
        connectString: connectString,
        user: connection.user,
        password: connection.password
      },
      pool: { 
        min: 0, 
        max: 10 
      },
    };

    console.log(`   📊 Database: ${type}`);
    console.log(`   🔌 Connect string: ${connectString}`);
    console.log(`   👤 User: ${connection.user}`);
    
  } else if (config.client == 'pg') {
    opt = {
      client: config.client,
      connection: {
        host: connection.host,
        port: +connection.port,
        user: connection.user,
        password: connection.password,
        searchPath: [connection.schema || 'public'],
        database: connection.database
        // timezone
      },
      pool: {
        min: 0,
        max: 100,
      }
    };
  } else {
    opt = {
      client: config.client,
      connection: {
        host: connection.host,
        port: +connection.port,
        user: connection.user,
        password: connection.password,
        database: connection.database
      },
      pool: {
        min: 0,
        max: 7
      },
      debug: false,
    };

    if (config.client.includes('mysql') && connection?.charset?.trim()) {
      opt.connection.charset = connection.charset.trim();
    }
  }
  
  return knex(opt);
};

module.exports = dbConnection;