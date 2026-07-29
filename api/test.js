export default {
  fetch() {
    return Response.json({ ok: true, time: Date.now() });
  },
};
