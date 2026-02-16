const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

async function obtenerPrecioPromedio(fiat, apiTradeType) {
  const url = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";
  
  const payload = {
    asset: "USDT",
    fiat: fiat,
    merchantCheck: true,
    page: 1,
    rows: 20,
    publisherType: null,
    tradeType: apiTradeType
  };
  
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"
  };

  try {
    const response = await axios.post(url, payload, { headers });
    const precios = response.data.data.map(adv => parseFloat(adv.adv.price));
    const rango = precios.slice(1, 20);
    
    if (rango.length === 0) return 0;
    return rango.reduce((a, b) => a + b) / rango.length;
    
  } catch (error) {
    console.error(`Error consultando ${fiat}:`, error.message);
    return 0;
  }
}

// Endpoint principal para obtener tasa
app.get('/tasa', async (req, res) => {
  try {
    const precioCompraCOP = await obtenerPrecioPromedio("COP", "SELL");
    const precioVentaVES = await obtenerPrecioPromedio("VES", "BUY");
    
    if (precioCompraCOP > 0 && precioVentaVES > 0) {
      const tasaReal = precioVentaVES / precioCompraCOP;
      const tasaFinal = tasaReal * 1.15; // 15% de margen
      
      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        datos: {
          usdtCOP: parseFloat(precioCompraCOP.toFixed(2)),
          usdtVES: parseFloat(precioVentaVES.toFixed(2)),
          tasaReal: parseFloat(tasaReal.toFixed(6)),
          tasaFinal: parseFloat(tasaFinal.toFixed(6))
        }
      });
    } else {
      res.status(500).json({ success: false, error: "No se pudieron obtener precios" });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint de debug detallado
app.get('/debug', async (req, res) => {
  try {
    const responseCOP = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      asset: 'USDT',
      fiat: 'COP',
      page: 1,
      rows: 20,
      tradeType: 'SELL',
      merchantCheck: true
    }, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
      }
    });

    const responseVES = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      asset: 'USDT',
      fiat: 'VES',
      page: 1,
      rows: 20,
      tradeType: 'BUY',
      merchantCheck: true
    }, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
      }
    });

    const preciosCOP = responseCOP.data.data
      .map(ad => parseFloat(ad.adv.price))
      .filter(p => p > 0)
      .sort((a, b) => a - b);

    const preciosVES = responseVES.data.data
      .map(ad => parseFloat(ad.adv.price))
      .filter(p => p > 0)
      .sort((a, b) => b - a);

    const copSeleccionados = preciosCOP.slice(1, 20);
    const vesSeleccionados = preciosVES.slice(1, 20);

    const usdtCOP = copSeleccionados.reduce((a, b) => a + b) / copSeleccionados.length;
    const usdtVES = vesSeleccionados.reduce((a, b) => a + b) / vesSeleccionados.length;

    const tasaReal = usdtCOP / usdtVES;
    const tasaFinal = tasaReal * 1.15;

    res.json({
      timestamp: new Date().toISOString(),
      COP: {
        todos_precios: preciosCOP.slice(0, 10),
        seleccionados: copSeleccionados.slice(0, 5),
        promedio: usdtCOP.toFixed(2)
      },
      VES: {
        todos_precios: preciosVES.slice(0, 10),
        seleccionados: vesSeleccionados.slice(0, 5),
        promedio: usdtVES.toFixed(2)
      },
      tasas: {
        real: tasaReal.toFixed(6),
        final: tasaFinal.toFixed(6)
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Binance Proxy API funcionando',
    endpoints: {
      tasa: '/tasa',
      debug: '/debug'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});