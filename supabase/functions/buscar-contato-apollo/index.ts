const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { nome, empresa, dominio } = await req.json();
    const apiKey = Deno.env.get("APOLLO_API_KEY");

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "APOLLO_API_KEY não configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const [firstName, ...lastParts] = (nome || "").trim().split(" ");
    const lastName = lastParts.join(" ");

    console.log(`Apollo people/match: ${firstName} ${lastName} @ ${empresa} (domain: ${dominio || "auto"})`);

    // Use the v1/people/match endpoint
    const matchResponse = await fetch("https://api.apollo.io/v1/people/match", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName || undefined,
        organization_name: empresa || undefined,
        domain: dominio || undefined,
        reveal_personal_emails: true,
        reveal_phone_number: true,
      }),
    });

    const responseText = await matchResponse.text();
    console.log(`Apollo response status: ${matchResponse.status}`);
    console.log(`Apollo response body: ${responseText.substring(0, 500)}`);

    if (!matchResponse.ok) {
      return new Response(
        JSON.stringify({ found: false, contacts: [], source: "apollo", error: `Status ${matchResponse.status}: ${responseText.substring(0, 200)}` }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let matchData;
    try {
      matchData = JSON.parse(responseText);
    } catch {
      return new Response(
        JSON.stringify({ found: false, contacts: [], source: "apollo", error: "Invalid JSON response" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const person = matchData.person;

    if (!person) {
      return new Response(
        JSON.stringify({ found: false, contacts: [], source: "apollo" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contact = {
      nome: person.name || `${person.first_name || ""} ${person.last_name || ""}`.trim(),
      email: person.email || null,
      email_status: person.email_status || null,
      emails_pessoais: person.personal_emails || [],
      telefone: person.organization?.phone || null,
      celular: person.phone_numbers?.find((p: any) => p.type === "mobile")?.sanitized_number
        || person.phone_numbers?.[0]?.sanitized_number || null,
      telefones: (person.phone_numbers || []).map((p: any) => ({
        numero: p.sanitized_number || p.raw_number,
        tipo: p.type,
      })),
      linkedin: person.linkedin_url || null,
      cargo: person.title || null,
      empresa: person.organization?.name || empresa,
      dominio_empresa: person.organization?.primary_domain || null,
      cidade: person.city || null,
      estado: person.state || null,
      pais: person.country || null,
      foto: person.photo_url || null,
      confianca: person.email_status === "verified" ? "alta" : person.email_status === "guessed" ? "media" : "baixa",
    };

    return new Response(
      JSON.stringify({ found: true, contacts: [contact], source: "apollo" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Erro na busca Apollo:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erro desconhecido" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
