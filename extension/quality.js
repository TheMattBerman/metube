const METUBE_QUALITY={
 version:5,
 prompt:"Replace only the identity of the main person in <image-1> with the exact person shown in <image-2>. This is the reference person wearing the original subject's hairstyle and beard as a costume. Make their face immediately recognizable: faithfully retain the reference person's eye shape and spacing, brows, nose bridge and tip, cheek shape, mouth and lip shape, and overall facial proportions. Do not average their face with the original person's face. The reference supplies facial identity, not its pose, cap, expression or background.\nPreserve the ORIGINAL subject's hairstyle, hair length, hair color and beard length, shape and color, including a long gray beard or long flowing hair where present. Integrate these naturally into the reference person's hairline, cheeks and jaw. One continuous believable beard, not a short beard pasted above a detached long beard. No extra chin or duplicate jaw. Do not shorten long hair or change the hairstyle to the reference person's short hair. Ignore the reference cap.\nKeep the original head position, scale, angle, gaze, expression, body, clothing, lighting, and camera perspective. Keep the reference person's head within the original head footprint without enlargement. Rebuild only the minimum facial and neck transition needed. Preserve all lettering EXACTLY, including letters crossing in front of the face; the text remains in front of the edited person. Preserve hands, foreground objects and background. The result must look like the reference person photographed in this scene with this hairstyle and beard, not a relative or a blended identity. Same framing and dimensions.",
 effectivePrompt(saved){
  if(!saved||saved.startsWith('Replace only the identity of the main person')||saved===this.prompt||saved.startsWith(this.prompt)||saved.includes('If there is no person, add the person')||saved.startsWith('Edit <image-1> only.')||saved.startsWith('Edit the photograph in <image-1>'))return this.prompt;
  return this.prompt+'\nAdditional user direction (must preserve the region and anatomy constraints above): '+saved;
 },
 async cacheKey(videoId,settings,reference,source=''){
  const fingerprint=JSON.stringify([this.version,settings.model||'berry',this.effectivePrompt(settings.prompt),reference,source]);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint));
  return videoId+':'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
 }
};
