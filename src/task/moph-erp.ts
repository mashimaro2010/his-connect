import moment = require("moment");
import { sendingToMoph, updateHISAlive, checkAdminRequest, updateAdminRequest, taskFunction, getHospitalConfig } from "../middleware/moph-refer";
import hisModel from './../routes/his/hismodel';
import { Knex } from 'knex';
import { platform, release } from "os";
const fs = require('fs');
import { getIP } from "../middleware/utils";
const packageJson = require('../../package.json');

const dbConnection = require('../plugins/db');
let db: Knex = dbConnection('HIS');
const hisProvider = process.env.HIS_PROVIDER || '';
const hisVersion = process.env.HIS_VERSION || '';
const hospcode = process.env.HOSPCODE || '';
let hospitalConfig: any = null;

export const sendBedOccupancy = async (dateProcess: any = null) => {
  hospitalConfig = await getHospitalConfig();

  let whatUTC = Intl?.DateTimeFormat().resolvedOptions().timeZone || '';
  let currDate: any;

  // ประมวลหลัง 1 ชั่วโมงเสมอ
  if (whatUTC == 'UTC' || whatUTC == 'Etc/UTC') {
    currDate = moment().locale('TH').add(7, 'hours').subtract(1, 'hours').startOf('hour').format('YYYY-MM-DD HH:mm:ss');
  } else {
    currDate = moment().locale('TH').subtract(1, 'hours').startOf('hour').format('YYYY-MM-DD HH:mm:ss');
  }

  let date = dateProcess || currDate;

  let dateOpd = date; // เฉพาะ OPD Visit
  let clinicResult = null, wardResult = null, opdResult = null;
  do {
    [clinicResult, wardResult] = await Promise.all([
      sendBedOccupancyByClinic(date),
      sendBedOccupancyByWard(date),
    ]);
    date = moment(date).add(1, 'day').format('YYYY-MM-DD');
  } while (date <= currDate);

  do {
    [opdResult] = await Promise.all([
      sendOpdVisitByClinic(dateOpd)
    ]);
    dateOpd = moment(dateOpd).add(1, 'day').format('YYYY-MM-DD');
  } while (dateOpd <= currDate);

  console.log('-'.repeat(70));
  return { clinicResult, wardResult, opdResult };
}

const sendBedOccupancyByWard = async (date: any) => {
  try {
    const occupancy_date = moment(date).locale('TH').endOf('hour').format('YYYY-MM-DD HH:mm:ss');
    let rows: any = await hisModel.concurrentIPDByWard(db, date);
    if (rows && rows.length) {
      rows = rows.map((v: any) => {
        return { ...v, occupancy_date, date, hospcode, his: hisProvider || '' };
      });
      const result: any = await sendingToMoph('/save-occupancy-rate-by-ward', rows);
      console.log(moment().format('HH:mm:ss'), 'send Occ Rate by ward', date, result.status || '', result.message || '', rows.length, 'rows');
    }
    console.log('-'.repeat(70));
    return rows;
  } catch (error) {
    console.error(moment().format('HH:mm:ss'), 'sendBedOccupancy error by ward', date, error.message);
    console.log('-'.repeat(70));
    return false;
  }
}

const sendBedOccupancyByClinic = async (date: any) => {
  try {
    let rows: any = await hisModel.concurrentIPDByClinic(db, date);
    if (rows && rows.length) {
      rows = rows.map(v => {
        return { ...v, date, hospcode, his: hisProvider || '' };
      });
      const result: any = await sendingToMoph('/save-occupancy-rate-by-clinic', rows);
      console.log(moment().format('HH:mm:ss'), 'send Occ rate by clinic', date, result.status || '', result.message || '', rows.length, 'rows');
    }
    return rows;
  } catch (error) {
    console.error(moment().format('HH:mm:ss'), 'sendBedOccupancy by clinic error', date, error.message);
    return false;
  }
}

const sendOpdVisitByClinic = async (date: any) => {
  try {
    let rows: any = await hisModel.sumOpdVisitByClinic(db, date);
    if (rows && rows.length) {
      rows = rows.map((v: any) => {
        return {
          ...v, hospcode, his: hisProvider || ''
        };
      });
      const result: any = await sendingToMoph('/save-sum-opd-visit-by-clinic', rows);
      console.log(moment().format('HH:mm:ss'), 'send Sum OPD visit by clinic', date, result.status || '', result.message || '', rows.length, 'rows');
    }
    return rows;
  } catch (error) {
    console.error(moment().format('HH:mm:ss'), 'sendSumOpdVisit by clinic error', date, error.message);
    return false;
  }
}

export const mophErpProcessTask = async () => {
  let result: any = await taskFunction('MOPH-ERP');
  // console.log('taskFunction', result);

  result = await taskFunction('sql', {
    function_name: 'getWard',
    his_name: hisProvider, his_version: hisVersion || ''
  });
  console.log('taskFunction', result);
  if (result?.statusCode == 200 && result?.row?.sql_string) {
    const sqlString = result.row.sql_string?.trim();
    console.log('get ward sql:', sqlString);
    if (sqlString) {
      try {
        let rows: any;
        const whereVariables = normalizeSqlWhereVariable(result.row?.sql_where_variable);
        if (/^db\s*\(/.test(sqlString)) {
          let queryBuilder = new Function('db', '"use strict"; return (' + sqlString + ');')(db);
          queryBuilder = applyWhereToBuilder(queryBuilder, whereVariables);
          console.log('queryBuilder 1:', queryBuilder.toSQL().toNative());
          rows = await queryBuilder; // execute dynamic knex builder
        } else {
          const { sql, bindings } = appendWhereClause(sqlString, whereVariables);
          console.log('queryBuilder 2:', db.raw(sql, bindings).toSQL().toNative());
          rows = bindings.length ? await db.raw(sql, bindings) : await db.raw(sqlString);
        }
        console.log(Array.isArray(rows) ? rows.length : rows);
      } catch (error) {
        console.error('execute sql_string error', error.message);
      }
    }
    // const rows = result?.data || [];
    // let wardResult: any;
    // if (rows && rows.length) {
    //   const wardRows = rows.map((v: any) => {
    //     return { ...v, hospcode: process.env.HOSPCODE || '' };
    //   });
    //   wardResult = await sendingToMoph('/save-ward', wardRows);
    //   console.log(moment().format('HH:mm:ss'), 'mophErpProcessTask sendWardName', wardResult.status || '', wardResult.message || '', wardRows.length);
    // }
  }
}

export const sendWardName = async () => {
  try {
    let rows: any = await hisModel.getWard(db);
    if (rows && rows.length) {
      rows = rows.map(v => {
        return { ...v, hospcode: process.env.HOSPCODE || '' };
      });
      const result: any = await sendingToMoph('/save-ward', rows);
      console.log(moment().format('HH:mm:ss'), 'sendWardName', result.status || '', result.message || '', rows.length, 'rows');
      console.log('-'.repeat(70));
      return result;
    } else {
      console.log(moment().format('HH:mm:ss'), 'sendWardName', 'No ward data');
      console.log('-'.repeat(70));
      return { statusCode: 200, message: 'No ward data' };
    }
  } catch (error) {
    console.log(moment().format('HH:mm:ss'), 'getWard error', error.message);
    console.log('-'.repeat(70));
    return [];
  }
}

export const sendBedNo = async () => {
  let errorMsg = '';
  const limitRow = 500;

  // helper: unwrap ผลลัพธ์ให้เป็น array เสมอ
  const unwrapRows = (result: any) => {
    if (!result) return [];
    if (Array.isArray(result)) return result;
    if (Array.isArray(result.rows)) return result.rows;
    if (Array.isArray(result.data)) return result.data;
    return [];
  };

  // helper: อ่าน countBed ให้ทนต่อ key หลายแบบ
  const readCount = (r: any) => {
    if (!r) return 0;
    const v =
      r.total_beds ?? r.TOTAL_BEDS ??
      r.total_bed ?? r.TOTAL_BED ??
      r.row_count ?? r.ROW_COUNT ??
      r.count ?? r.COUNT ??
      r['COUNT(*)'] ?? r['count(*)'];
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  try {
    // 1) expected count (เพื่อ log/ควบคุม)
    let expected = 0;
    if (typeof hisModel.countBedNo === 'function') {
      const c = await hisModel.countBedNo(db);
      expected = readCount(c);
    }

    // 2) ดึงข้อมูลจริงครั้งเดียว (ไม่พึ่ง paging args)
    const bedsResult = await (hisModel as any).getBedNo(db);
    const allRows: any[] = unwrapRows(bedsResult);

    if (!allRows.length) {
      console.log(moment().format('HH:mm:ss'), 'sendBedNo', 'No bed data');
      console.log('-'.repeat(70));
      return { statusCode: 200, message: 'No bed data' };
    }

    // ถ้า expected เป็น 0 ให้ใช้จำนวนจริงแทน
    if (!expected) expected = allRows.length;

    // 3) ส่งเป็น chunk
    let sentTotal = 0;
    let times = 0;

    for (let startRow = 0; startRow < allRows.length; startRow += limitRow) {
      const chunk = allRows.slice(startRow, startRow + limitRow).map(v => ({
        ...v,
        hospcode,
        hcode5: hospcode.length === 5 ? hospcode : null,
        hcode9: hospcode.length === 9 ? hospcode : null
      }));

      const result: any = await sendingToMoph('/save-bed-no', chunk);

      const rawData = result?.data ?? result?.rows ?? result?.result ?? null;
      const arr = Array.isArray(rawData) ? rawData : [];
      const okCount = arr.filter(x => x === 1 || x === '1' || x === true).length;
      const failCount = arr.length ? (arr.length - okCount) : 0;

      console.log(
        moment().format('HH:mm:ss'),
        '[sendBedNo] chunk response',
        'startRow=', startRow,
        'size=', chunk.length,
        'status=', result?.status ?? result?.statusCode,
        'message=', result?.message ?? '',
        'dataLen=', arr.length,
        'ok=', okCount,
        'fail=', failCount
      );

      if (result?.status != 200 && result?.statusCode != 200) {
        console.log(
          moment().format('HH:mm:ss'),
          '[sendBedNo] API fail',
          'startRow=', startRow,
          'size=', chunk.length,
          'resp=', JSON.stringify(result, null, 2)
        );
        errorMsg = result?.message || String(result?.status || result?.statusCode || '');
      }

      sentTotal += chunk.length;
      times++;
    }

    console.log(
      moment().format('HH:mm:ss'),
      `sendBedNo sent=${sentTotal} expected=${expected} chunks=${times}`,
      errorMsg
    );
    console.log('-'.repeat(70));

    return {
      statusCode: errorMsg ? 500 : 200,
      message: errorMsg || 'ok',
      sent: sentTotal,
      expected,
      chunks: times
    };

  } catch (error: any) {
    console.log(moment().format('HH:mm:ss'), 'getBedNo error', error?.message || error);
    console.log('-'.repeat(70));
    return { statusCode: error?.status || 500, message: error?.message || error };
  }
};

export const updateAlive = async () => {
  const ipServer: any = getIP();
  try {
    const apiEnv = await detectRuntimeEnvironment();

    let data = {
      api_date: global.apiStartTime,
      server_date: moment().format('YYYY-MM-DD HH:mm:ss'),
      hospcode,
      version: packageJson.version || '',
      subversion: packageJson.subVersion || '',
      port: process.env.PORT || 0,
      ip: ipServer.ip,
      host_type: apiEnv || 'host',
      nodejs: process.version || '',
      platform: platform() || '',
      os_version: release() || '',
      his: hisProvider, ssl: process.env?.SSL_ENABLE || 0,
      /* 
        `dbconnect` tinyint unsigned DEFAULT NULL,
      */
    };
    const result: any = await updateHISAlive(data);
    const status = result.status == 200 || result.statusCode == 200 ? true : false;
    if (status) {
      console.log(moment().format('HH:mm:ss'), '✅ Sent API Alive status result', result.status || '', result.statusCode || '', result?.message || '');
    } else {
      console.error(moment().format('HH:mm:ss'), '❌ Sent API Alive status result', result.status || '', result.statusCode || '', result?.message || '');
    }
    console.log('-'.repeat(70));
    return result;
  } catch (error) {
    console.error(moment().format('HH:mm:ss'), '❌ Sent API Alive status error:', error?.status || error?.statusCode || '', error?.message || error || '');
    console.log('-'.repeat(70));
    return [];
  }
}

export const erpAdminRequest = async () => {
  try {
    const result: any = await checkAdminRequest();
    const rows = result?.rows || result?.data || [];
    if (rows && rows.length > 0) {
      let requestResult: any;
      for (let row of rows) {
        if (row.request_type == 'bed') {
          requestResult = await sendBedNo();
          console.log(moment().format('HH:mm:ss'), 'ERP admin request get bed no.', requestResult?.statusCode || requestResult?.status || '', requestResult?.message || '');
        } else if (row.request_type == 'ward') {
          requestResult = await sendWardName();
          console.log(moment().format('HH:mm:ss'), 'ERP admin request get ward name.', requestResult?.statusCode || requestResult?.status || '', requestResult?.message || '');
        } else if (row.request_type == 'alive') {
          requestResult = await updateAlive();
          console.log(moment().format('HH:mm:ss'), 'ERP admin request send alive status.', requestResult?.statusCode || requestResult?.status || '', requestResult?.message || '');
        } else if (row.request_type == 'occupancy') {
          requestResult = await sendBedOccupancy();
          console.log(moment().format('HH:mm:ss'), 'ERP admin request occupancy', requestResult?.statusCode || requestResult?.status || '', requestResult?.message || '');
        }
        const updateResult = await updateAdminRequest({
          request_id: row.request_id,
          status: requestResult?.statusCode == 200 || requestResult?.status == 200 ? 'success' : `failed ${requestResult?.status || requestResult?.statusCode || ''}`,
          isactive: 0
        });
        console.log(moment().format('HH:mm:ss'), 'ERP admin request update status', updateResult?.statusCode || updateResult?.status || '', updateResult?.message || '');
      }
    } else {
      console.log(moment().format('HH:mm:ss'), 'No admin request', result.status || result?.statusCode || '', result?.data?.message || result?.message || '');
    }
    console.log('-'.repeat(70));
    return result;
  } catch (error) {
    console.log(moment().format('HH:mm:ss'), 'Admin Request error', error.message);
    // console.log(moment().format('HH:mm:ss'), 'API Alive error', error.message);
    console.log('-'.repeat(70));
    return [];
  }
}

function getCode9(hcode: string = hospcode) {

}

function normalizeSqlWhereVariable(input: any): Record<string, any> {
  if (!input) {
    return {};
  }

  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return typeof parsed === 'object' && parsed ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  if (typeof input === 'object') {
    return input;
  }

  return {};
}

function applyWhereToBuilder(queryBuilder: any, whereVariables: Record<string, any>) {
  if (!queryBuilder || typeof queryBuilder.where !== 'function') {
    return queryBuilder;
  }

  Object.entries(whereVariables).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    const column = toSnakeCase(key);
    queryBuilder.where(column, value);
  });

  return queryBuilder;
}

function appendWhereClause(sqlString: string, whereVariables: Record<string, any>) {
  const activeFilters = Object.entries(whereVariables).filter(([_, value]) => value !== undefined && value !== null && value !== '');
  if (!activeFilters.length) {
    return { sql: sqlString, bindings: [] };
  }

  const hasWhere = /\bwhere\b/i.test(sqlString);
  const bindings: any[] = [];
  const conditions = activeFilters.map(([key, value]) => {
    bindings.push(value);
    return `${toSnakeCase(key)} = ?`;
  });

  const clause = conditions.join(' AND ');
  const separator = hasWhere ? ' AND ' : ' WHERE ';
  return { sql: sqlString + separator + clause, bindings };
}

function toSnakeCase(value: string) {
  if (!value) {
    return value;
  }

  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

async function detectRuntimeEnvironment() {
  // Default = host
  let env: "docker" | "kubernetes" | "wsl" | "host" = "host";

  // -------------------------------
  // 1) ตรวจ Docker แบบชัวร์ที่สุด
  // -------------------------------
  if (fs.existsSync("/.dockerenv")) {
    env = "docker";
  } else {
    try {
      const cgroup = fs.readFileSync("/proc/1/cgroup", "utf8");

      // Docker / containerd
      if (/docker|containerd/i.test(cgroup)) {
        env = "docker";
      }

      // Kubernetes pod
      if (/kubepods/i.test(cgroup)) {
        env = "kubernetes";
      }
    } catch { }
  }

  // -------------------------------
  // 2) ตรวจ WSL (WSL1 / WSL2)
  // -------------------------------
  const r = release().toLowerCase();
  try {
    const version = fs.readFileSync("/proc/version", "utf8").toLowerCase();
    if (
      r.includes("microsoft") ||
      r.includes("wsl") ||
      version.includes("microsoft")
    ) {
      env = "wsl";
    }
  } catch { }

  // -------------------------------
  // 3) Return พร้อมข้อมูลเพิ่มเติม
  // -------------------------------
  return env;
}