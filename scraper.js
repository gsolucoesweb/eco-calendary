const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const express = require('express');

// Configurações do scraper
const CONFIG = {
    // URL de teste - substitua quando for fazer a integração real
    WORDPRESS_URL: 'https://new.ecothermas.com.br/wp-json/ecothermas/v1/atualizar-precos',
    // Define se vai enviar para o WordPress ou apenas salvar localmente
    APENAS_TESTE_LOCAL: false,
    // Define se o navegador será visível ou não durante a execução (sempre false no Render)
    MODO_VISIVEL: false,
    // Tempo de espera para visualização da página antes de fechar (em milissegundos)
    TEMPO_VISUALIZACAO: 10000,
    // Porta do servidor
    PORT: process.env.PORT || 3000
};

/**
 * Extrai os dados do calendário do site da Ecothermas
 */
async function extrairDadosCalendario() {
    console.log('Iniciando extração de dados...');
    
        // Inicia o navegador com configurações otimizadas para produção
        const browser = await puppeteer.launch({
            headless: true, // Sempre headless no Render
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu',
                '--window-size=1366,768'
            ]
        });
    
    try {
        const page = await browser.newPage();
        
        // Configura viewport e user agent
        await page.setViewport({ width: 1366, height: 768 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36');
        
        // Acessa o site
        console.log('Acessando site da Ecothermas...');
        await page.goto('https://ingressos.ecothermas.com.br/', {
            waitUntil: 'networkidle2',
            timeout: 60000 // 60 segundos para carregar a página
        });
        
        // Aguarda um pouco para a página carregar completamente
        console.log('Aguardando carregamento da página...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Verifica se existem elementos de calendário na página
        console.log('Verificando elementos de calendário disponíveis...');
        const elementosCalendario = await page.evaluate(() => {
            const possiveisSeletores = [
                '.limber-calendar',
                '.calendar',
                '[class*="calendar"]',
                '[class*="Calendar"]',
                '.mat-calendar',
                '.datepicker',
                '[class*="date"]'
            ];
            
            const encontrados = [];
            possiveisSeletores.forEach(seletor => {
                const elementos = document.querySelectorAll(seletor);
                if (elementos.length > 0) {
                    encontrados.push({
                        seletor: seletor,
                        quantidade: elementos.length,
                        classes: Array.from(elementos).map(el => el.className)
                    });
                }
            });
            
            return {
                encontrados,
                todasAsClasses: Array.from(document.querySelectorAll('*')).map(el => el.className).filter(c => c && c.includes('calendar')).slice(0, 20)
            };
        });
        
        console.log('Elementos de calendário encontrados:', JSON.stringify(elementosCalendario, null, 2));
        
        // Tenta encontrar o calendário com diferentes seletores
         let calendarioEncontrado = false;
         const seletoresPossiveis = ['.limber-calendar-month', '.limber-calendar', '.calendar', '[class*="calendar"]', '.mat-calendar'];
         
         for (const seletor of seletoresPossiveis) {
             try {
                 console.log(`Tentando seletor: ${seletor}`);
                 await page.waitForSelector(seletor, { timeout: 5000 });
                 console.log(`Calendário encontrado com seletor: ${seletor}`);
                 calendarioEncontrado = true;
                 break;
             } catch (error) {
                 console.log(`Seletor ${seletor} não funcionou`);
             }
         }
         
         if (!calendarioEncontrado) {
             throw new Error('Nenhum calendário foi encontrado na página');
         }
        
        // Captura screenshot para verificação visual
        await page.screenshot({ path: 'ecothermas-site.png', fullPage: true });
        console.log('Screenshot capturado para verificação (ecothermas-site.png)');
        
        // Obtém o mês e ano atual
        const dataAtual = new Date();
        const anoMes = `${dataAtual.getFullYear()}-${String(dataAtual.getMonth() + 1).padStart(2, '0')}`;
        console.log(`Extraindo dados para o mês: ${anoMes}`);
        
        // Extrai todos os dados do calendário
        const dados = await page.evaluate(() => {
            const resultado = {};
            const anoMes = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
            resultado[anoMes] = {};
            
            // Seleciona todas as células do calendário usando o seletor correto
            const celulas = document.querySelectorAll('.limber-calendar-month button.mat-ripple');
            console.log(`Encontradas ${celulas.length} células no calendário`);
            
            celulas.forEach(celula => {
                // Extrai o número do dia - procura pelo span com o número
                const diaEl = celula.querySelector('span[style*="font-size: 13px; font-weight: 500"]');
                if (!diaEl) return;
                
                const dia = diaEl.textContent.trim();
                if (!dia || isNaN(parseInt(dia))) return;
                
                const diaFormatado = String(parseInt(dia)).padStart(2, '0');
                
                // Determina o status com base no estilo do botão
                const style = celula.getAttribute('style') || '';
                const classes = celula.className || '';
                let status = 'weekday';
                
                // Verifica se está desabilitado (dias passados ou indisponíveis)
                if (celula.disabled || classes.includes('opacity-30')) {
                    status = 'disabled';
                } else if (style.includes('rgba(243, 231, 41')) {
                    status = 'saturday';
                } else if (style.includes('rgba(255, 146, 56')) {
                    status = 'holiday';
                }
                
                // Extrai o preço - procura pelo span com o preço
                let price = '—';
                const precoSpans = celula.querySelectorAll('span');
                
                // Procura por spans que podem conter preços
                precoSpans.forEach(span => {
                    const texto = span.textContent.trim();
                    // Se encontrar um texto que parece ser preço (contém números e não é o dia)
                    if (texto !== dia && texto !== '—' && /\d/.test(texto)) {
                        price = texto;
                    }
                });
                
                // Se não encontrou preço específico, verifica se há span com "—"
                const precoEl = celula.querySelector('span.whitespace-nowrap');
                if (precoEl) {
                    const precoTexto = precoEl.textContent.trim();
                    if (precoTexto && precoTexto !== '—') {
                        price = precoTexto;
                    }
                }
                
                resultado[anoMes][diaFormatado] = { price, status };
                console.log(`Dia ${diaFormatado}: preço=${price}, status=${status}`);
            });
            
            return resultado;
        });
        
        console.log('Dados extraídos com sucesso!');
        return dados;
        
    } catch (error) {
        console.error('Erro durante a extração:', error);
        return null;
    } finally {
        if (CONFIG.MODO_VISIVEL) {
            // Aguarda um tempo para você poder ver o resultado antes de fechar
            console.log(`Aguardando ${CONFIG.TEMPO_VISUALIZACAO/1000} segundos antes de fechar o navegador...`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.TEMPO_VISUALIZACAO));
        }
        await browser.close();
        console.log('Navegador fechado.');
    }
}

/**
 * Salva os dados extraídos em um arquivo JSON local
 */
async function salvarDadosLocalmente(dados) {
    console.log('Salvando dados extraídos localmente...');
    
    try {
        // Registra os dados em um arquivo para verificação
        fs.writeFileSync('dados_extraidos.json', JSON.stringify(dados, null, 2));
        console.log('Dados salvos com sucesso em dados_extraidos.json');
        return true;
    } catch (error) {
        console.error('Erro ao salvar dados:', error.message);
        return false;
    }
}

/**
 * Envia os dados para a API do WordPress
 */
async function enviarDadosParaWordPress(dados) {
    console.log('Enviando dados para o WordPress...');
    
    try {
        // Envia para a API do WordPress
        const response = await axios.post(CONFIG.WORDPRESS_URL, {
            dados: JSON.stringify(dados)
        });
        
        console.log('Resposta do WordPress:', response.data);
        return true;
    } catch (error) {
        console.error('Erro ao enviar dados para o WordPress:', error.message);
        return false;
    }
}

/**
 * Função principal do script
 */
async function executarScraping() {
    try {
        console.log('=== ECOTHERMAS SCRAPER ===');
        console.log('Iniciando o processo de extração...');
        
        // Extrai os dados do calendário
        const dados = await extrairDadosCalendario();
        
        if (dados) {
            console.log('\nDADOS EXTRAÍDOS:');
            console.log(JSON.stringify(dados, null, 2));
            
            // Salva os dados em um arquivo local
            await salvarDadosLocalmente(dados);
            
            // Se não estiver no modo de teste, envia para o WordPress
            if (!CONFIG.APENAS_TESTE_LOCAL) {
                await enviarDadosParaWordPress(dados);
            } else {
                console.log('\nMODO TESTE LOCAL: Os dados não foram enviados para o WordPress.');
                console.log('Para enviar, altere a configuração APENAS_TESTE_LOCAL para false.');
            }
            
            console.log('\nProcesso concluído com sucesso!');
            return { success: true, data: dados };
        } else {
            console.log('\nFalha ao extrair os dados.');
            return { success: false, error: 'Falha ao extrair os dados' };
        }
    } catch (error) {
        console.error('\nErro durante a execução do script:', error);
        return { success: false, error: error.message };
    }
}

// Configuração do servidor Express
const app = express();

// Middleware para parsing JSON
app.use(express.json());

// Endpoint de health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Ecothermas Scraper está rodando',
        timestamp: new Date().toISOString()
    });
});

// Endpoint para executar o scraping (usado pelo cron job)
app.post('/scrape', async (req, res) => {
    console.log(`[${new Date().toISOString()}] Iniciando scraping via endpoint...`);
    
    try {
        const resultado = await executarScraping();
        res.json(resultado);
    } catch (error) {
        console.error('Erro no endpoint de scraping:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Endpoint GET para scraping (alternativo)
app.get('/scrape', async (req, res) => {
    console.log(`[${new Date().toISOString()}] Iniciando scraping via GET...`);
    
    try {
        const resultado = await executarScraping();
        res.json(resultado);
    } catch (error) {
        console.error('Erro no endpoint de scraping:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Inicia o servidor
app.listen(CONFIG.PORT, () => {
    console.log(`Servidor rodando na porta ${CONFIG.PORT}`);
    console.log(`Health check: http://localhost:${CONFIG.PORT}/`);
    console.log(`Scraping endpoint: http://localhost:${CONFIG.PORT}/scrape`);
});

// Executa o scraping uma vez na inicialização (opcional)
if (process.env.RUN_ON_START !== 'false') {
    setTimeout(() => {
        console.log('Executando scraping inicial...');
        executarScraping();
    }, 5000); // Aguarda 5 segundos após iniciar o servidor
}