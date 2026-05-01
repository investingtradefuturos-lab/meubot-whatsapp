const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const app = express();
app.use(express.json());

const EVOLUTION_URL = process.env.EVOLUTION_URL;
const EVOLUTION_KEY = process.env.EVOLUTION_KEY;
const OPENAI_KEY = process.env.OPENAI_KEY;
const INSTANCE = process.env.INSTANCE || 'meubot';

const perfis = {
  '/advogado': 'Você é um advogado formal e eloquente. Use termos jurídicos, cite artigos de lei quando possível e seja muito preciso.',
  '/medico': 'Você é um médico clínico. Use terminologia médica quando apropriado, seja claro e objetivo, e sempre recomende consultar um profissional.',
  '/executivo': 'Você é um executivo de alto nível. Seja direto, focado em resultados, use linguagem corporativa e pense sempre em ROI.',
  '/professor': 'Você é um professor didático. Explique de forma clara, use exemplos práticos e seja paciente e encorajador.',
  '/programador': 'Você é um programador sênior. Pense de forma lógica, use analogias técnicas e seja preciso e eficiente.',
  '/detetive': 'Você é um detetive perspicaz. Analise detalhes, faça perguntas investigativas e chegue a conclusões lógicas.',
  '/sarcastico': 'Você é extremamente sarcástico e irônico. Use humor ácido, dê respostas irônicas mas mantenha a inteligência.',
  '/engraçado': 'Você é muito engraçado e bem-humorado. Use humor, trocadilhos e deixe a conversa leve e divertida.',
  '/grosseiro': 'Você é direto, sem rodeios e um pouco rude. Vá direto ao ponto sem papas na língua.',
  '/educado': 'Você é extremamente educado, gentil e cordial. Use sempre "por favor" e "obrigado" e seja muito atencioso.',
  '/nerd': 'Você é um nerd apaixonado por conhecimento. Faça referências a filmes, séries, jogos e ciência constantemente.',
  '/filosofo': 'Você é um filósofo profundo. Questione tudo, cite filósofos famosos e pense de forma abstrata e reflexiva.',
  '/motivacional': 'Você é um coach motivacional. Seja extremamente entusiasmado, positivo e encoraje a pessoa com energia.',
  '/descolado': 'Você é muito descolado e moderno. Use gírias atuais, seja informal e fale como alguém antenado nas tendências.',
  '/formal': 'Você escreve de forma muito formal e rebuscada. Use vocabulário sofisticado e construções gramaticais complexas.',
  '/informal': 'Você escreve de forma super casual e informal. Use gírias, abreviações e seja completamente descontraído.',
  '/poetico': 'Você é um poeta. Responda sempre de forma poética, use metáforas, rimas quando possível e linguagem bela.',
  '/direto': 'Você é extremamente direto e conciso. Responda sempre em no máximo 2 frases curtas, sem rodeios.',
  '/rebuscado': 'Você usa linguagem extremamente rebuscada e erudita. Use palavras raras e construções linguísticas complexas.',
};

const sessoes = {};

async function transcreverAudio(audioBuffer, mimeType) {
  const form = new FormData();
  form.append('file', audioBuffer, { filename: 'audio.ogg', contentType: mimeType || 'audio/ogg' });
  form.append('model', 'whisper-1');
  form.append('language', 'pt');

  const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
    headers: { ...form.getHeaders(), Authorization: `Bearer ${OPENAI_KEY}` },
  });
  return response.data.text;
}

async function corrigirTexto(texto, perfil) {
  const systemPrompt = perfis[perfil] || 'Você é um assistente útil e amigável.';
  const response = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: `${systemPrompt}\n\nSua tarefa: receba o texto transcrito de um áudio, corrija erros de português e reescreva no estilo do seu perfil. Retorne apenas o texto corrigido e reescrito, sem explicações.` },
      { role: 'user', content: texto }
    ],
  }, { headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' } });
  return response.data.choices[0].message.content;
}

async function enviarMensagem(numero, texto) {
  await axios.post(`${EVOLUTION_URL}/message/sendText/${INSTANCE}`, {
    number: numero,
    text: texto,
  }, { headers: { apikey: EVOLUTION_KEY, 'Content-Type': 'application/json' } });
}

async function baixarAudio(mediaKey) {
  const response = await axios.get(`${EVOLUTION_URL}/chat/getBase64FromMediaMessage/${INSTANCE}`, {
    headers: { apikey: EVOLUTION_KEY },
    params: { messageId: mediaKey },
  });
  const base64 = response.data.base64;
  return Buffer.from(base64, 'base64');
}

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    const event = body.event;
    if (event !== 'messages.upsert') return;

    const data = body.data;
    if (!data || !data.key || data.key.fromMe) return;

    const numero = data.key.remoteJid;
    const msg = data.message;
    if (!msg) return;

    if (!sessoes[numero]) sessoes[numero] = '/educado';

    // Verifica se é um comando de perfil
    const textMsg = msg.conversation || msg.extendedTextMessage?.text || '';
    if (textMsg && perfis[textMsg.toLowerCase().trim()]) {
      sessoes[numero] = textMsg.toLowerCase().trim();
      const nomes = { '/advogado':'Advogado', '/medico':'Médico', '/executivo':'Executivo', '/professor':'Professor', '/programador':'Programador', '/detetive':'Detetive', '/sarcastico':'Sarcástico', '/engraçado':'Engraçado', '/grosseiro':'Grosseiro', '/educado':'Educado', '/nerd':'Nerd', '/filosofo':'Filósofo', '/motivacional':'Motivacional', '/descolado':'Descolado', '/formal':'Formal', '/informal':'Informal', '/poetico':'Poético', '/direto':'Direto', '/rebuscado':'Rebuscado' };
      await enviarMensagem(numero, `✅ Perfil ativado: *${nomes[sessoes[numero]]}*\n\nAgora mande um áudio e eu transcrevo e reescrevo nesse estilo!`);
      return;
    }

    // Verifica se é /perfis para listar
    if (textMsg.toLowerCase().trim() === '/perfis') {
      const lista = Object.keys(perfis).join('\n');
      await enviarMensagem(numero, `📋 *Perfis disponíveis:*\n\n${lista}\n\nDigite qualquer um desses comandos para ativar!`);
      return;
    }

    // Verifica se é áudio
    const audioMsg = msg.audioMessage || msg.pttMessage;
    if (!audioMsg) return;

    await enviarMensagem(numero, '🎤 Transcrevendo seu áudio...');

    const audioBuffer = await baixarAudio(data.key.id);
    const transcricao = await transcreverAudio(audioBuffer, 'audio/ogg');
    const corrigido = await corrigirTexto(transcricao, sessoes[numero]);

    await enviarMensagem(numero, `📝 *Transcrição corrigida:*\n\n${corrigido}`);
  } catch (err) {
    console.error('Erro:', err.message);
  }
});

app.get('/', (req, res) => res.json({ status: 'Bot rodando!' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot rodando na porta ${PORT}`));
