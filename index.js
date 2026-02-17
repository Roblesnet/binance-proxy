const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// ✅ CACHÉ GLOBAL
let ultimaTasa = null;
let ultimaActualizacion = null;
const CACHE_DURATION = 3 * 60 * 1000; // 3 minutos
let erroresConsecutivos = 0;
let totalRequests = 0;
let requestsDesdeCache = 0;

// ✅ FUNCIÓN PRINCIPAL CON PROTECCIONES
async function obtenerTasaBinance() {
  totalRequests++;
  
  try {
    console.log('🔍 Consultando Binance P2P...');

    // COP - REDUCIDO A 10 ROWS
    const responseCOP = await axios.post(
      'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
      {
        asset: 'USDT',
        fiat: 'COP',
        page: 1,
        rows: 10, // ✅ Reducido de 20 a 10
        tradeType: 'BUY',
        merchantCheck: true,
        publisherType: null
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 10000 // 10 segundos timeout
      }
    );

    const preciosCOP = responseCOP.data.data
      .map(ad => parseFloat(ad.adv.price))
      .filter(p => p > 0)
      .sort((a, b) => a - b)
      .slice(1, 7); // Posiciones 2-7

    if (preciosCOP.length === 0) {
      throw new Error('No se encontraron precios COP válidos');
    }

    const usdtCOP = preciosCOP.reduce((a, b) => a + b) / preciosCOP.length;

    // VES - REDUCIDO A 10 ROWS
    const responseVES = await axios.post(
      'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
      {
        asset: 'USDT',
        fiat: 'VES',
        page: 1,
        rows: 10, // ✅ Reducido de 20 a 10
        tradeType: 'SELL',
        merchantCheck: true,
        publisherType: null
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 10000
      }
    );

    const preciosVES = responseVES.data.data
      .map(ad => parseFloat(ad.adv.price))
      .filter(p => p > 0)
      .sort((a, b) => b - a)
      .slice(1, 7); // Posiciones 2-7

    if (preciosVES.length === 0) {
      throw new Error('No se encontraron precios VES válidos');
    }

    const usdtVES = preciosVES.reduce((a, b) => a + b) / preciosVES.length;

    // ✅ CÁLCULO CORRECTO
    const tasaReal = usdtCOP / usdtVES;
    const tasaFinal = tasaReal / 1.15; // ✅ DIVISIÓN para aplicar margen del 15%

    erroresConsecutivos = 0; // Reset si todo va bien

    console.log(`✅ Tasa calculada: ${tasaFinal.toFixed(2)}`);

    return {
      success: true,
      timestamp: new Date().toISOString(),
      datos: {
        usdtCOP: parseFloat(usdtCOP.toFixed(2)),
        usdtVES: parseFloat(usdtVES.toFixed(2)),
        tasaReal: parseFloat(tasaReal.toFixed(4)),
        tasaFinal: parseFloat(tasaFinal.toFixed(4))
      }
    };

  } catch (error) {
    erroresConsecutivos++;
    console.error(`❌ Error ${erroresConsecutivos}/3:`, error.message);

    // Si falla 3 veces seguidas, espera más tiempo antes de reintentar
    if (erroresConsecutivos >= 3) {
      console.log('⚠️ Demasiados errores consecutivos, esperando 30 minutos...');
      // No lanzar error, solo esperar
      setTimeout(() => {
        erroresConsecutivos = 0;
        console.log('🔄 Reseteando contador de errores');
      }, 30 * 60 * 1000);
    }

    throw error;
  }
}

// ✅ ENDPOINT /TASA CON CACHÉ INTELIGENTE
app.get('/tasa', async (req, res) => {
  // Verificar si hay caché válido
  if (ultimaTasa && ultimaActualizacion) {
    const edadCache = Date.now() - ultimaActualizacion;
    
    if (edadCache < CACHE_DURATION) {
      requestsDesdeCache++;
      console.log(`✅ Respondiendo desde caché (${Math.floor(edadCache/1000)}s antigüedad)`);
      
      return res.json({
        ...ultimaTasa,
        cache: true,
        cacheAge: Math.floor(edadCache / 1000),
        stats: {
          totalRequests,
          fromCache: requestsDesdeCache,
          efficiency: `${Math.floor(requestsDesdeCache/totalRequests*100)}%`
        }
      });
    }
  }

  // Si no hay caché válido, consultar Binance
  try {
    const resultado = await obtenerTasaBinance();
    ultimaTasa = resultado;
    ultimaActualizacion = Date.now();
    
    res.json({
      ...resultado,
      cache: false
    });
  } catch (error) {
    // Si hay error pero tenemos caché viejo, usarlo
    if (ultimaTasa) {
      const edadCache = Date.now() - ultimaActualizacion;
      console.log('⚠️ Error en Binance, usando caché antiguo');
      
      return res.json({
        ...ultimaTasa,
        cache: true,
        cacheAge: Math.floor(edadCache / 1000),
        warning: 'Usando datos en caché debido a error temporal'
      });
    }

    // Si no hay caché, devolver error
    res.status(500).json({
      success: false,
      error: 'No se pudo obtener la tasa de Binance',
      message: error.message
    });
  }
});

// ✅ ENDPOINT /DEBUG (sin caché, consulta directa)
app.get('/debug', async (req, res) => {
  try {
    const responseCOP = await axios.post(
      'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
      {
        asset: 'USDT',
        fiat: 'COP',
        page: 1,
        rows: 10,
        tradeType: 'BUY',
        merchantCheck: true
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
        }
      }
    );

    const responseVES = await axios.post(
      'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
      {
        asset: 'USDT',
        fiat: 'VES',
        page: 1,
        rows: 10,
        tradeType: 'SELL',
        merchantCheck: true
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
        }
      }
    );

    const preciosCOP = responseCOP.data.data
      .map(ad => parseFloat(ad.adv.price))
      .filter(p => p > 0)
      .sort((a, b) => a - b);

    const preciosVES = responseVES.data.data
      .map(ad => parseFloat(ad.adv.price))
      .filter(p => p > 0)
      .sort((a, b) => b - a);

    const copSeleccionados = preciosCOP.slice(1, 7);
    const vesSeleccionados = preciosVES.slice(1, 7);

    const usdtCOP = copSeleccionados.reduce((a, b) => a + b) / copSeleccionados.length;
    const usdtVES = vesSeleccionados.reduce((a, b) => a + b) / vesSeleccionados.length;

    const tasaReal = usdtCOP / usdtVES;
    const tasaFinal = tasaReal * 1.15; // ✅ CORRECTO

    res.json({
      timestamp: new Date().toISOString(),
      COP: {
        todos_precios: preciosCOP.slice(0, 10),
        seleccionados: copSeleccionados,
        promedio: usdtCOP.toFixed(2)
      },
      VES: {
        todos_precios: preciosVES.slice(0, 10),
        seleccionados: vesSeleccionados,
        promedio: usdtVES.toFixed(2)
      },
      tasas: {
        real: tasaReal.toFixed(4),
        final_con_margen: tasaFinal.toFixed(4),
        margen: '15%',
        formula: 'tasaFinal = (COP/VES) * 1.15'
      },
      explicacion: {
        mensaje: 'La tasa FINAL es MENOR que la real porque aplicamos 15% de margen.',
        ejemplo: `Con $100.000 COP, el cliente recibe ${(100000/tasaFinal).toFixed(2)} Bs`
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✅ HEALTH CHECK CON STATS
app.get('/', (req, res) => {
  const uptime = process.uptime();
  const edadCache = ultimaActualizacion ? Math.floor((Date.now() - ultimaActualizacion) / 1000) : null;
  
  res.json({
    status: 'ok',
    message: 'Binance Proxy API funcionando',
    uptime: `${Math.floor(uptime / 60)} minutos`,
    cache: {
      activo: ultimaTasa !== null,
      edad_segundos: edadCache,
      valido: edadCache ? edadCache < 180 : false
    },
    stats: {
      totalRequests,
      fromCache: requestsDesdeCache,
      efficiency: totalRequests > 0 ? `${Math.floor(requestsDesdeCache/totalRequests*100)}%` : '0%',
      erroresConsecutivos
    },
    endpoints: {
      tasa: '/tasa (con caché de 3 min)',
      debug: '/debug (consulta directa sin caché)'
    }
  });
});

// ✅ ACTUALIZACIÓN AUTOMÁTICA CADA 5 MINUTOS
setInterval(async () => {
  try {
    console.log('🔄 Actualización automática programada...');
    const resultado = await obtenerTasaBinance();
    ultimaTasa = resultado;
    ultimaActualizacion = Date.now();
    console.log(`✅ Caché actualizado automáticamente: ${resultado.datos.tasaFinal}`);
  } catch (error) {
    console.error('❌ Error en actualización automática:', error.message);
  }
}, 5 * 60 * 1000); // ✅ CADA 5 MINUTOS

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  
  // ✅ Primera carga al iniciar
  console.log('📥 Cargando tasa inicial...');
  obtenerTasaBinance()
    .then(resultado => {
      ultimaTasa = resultado;
      ultimaActualizacion = Date.now();
      console.log(`✅ Tasa inicial cargada: ${resultado.datos.tasaFinal}`);
    })
    .catch(error => {
      console.error('❌ Error cargando tasa inicial:', error.message);
    });
});