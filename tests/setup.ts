// Pre-carregado pelos testes (node --import): força o modo template para os
// testes rodarem offline e determinísticos, sem chamar Gemini/Anthropic.
process.env.IA_PROVEDOR = 'template';
