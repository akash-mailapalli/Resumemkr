// Export Utilities for ResumeMkr
// Uses jsPDF, html2canvas, and docx.js loaded from global CDNs

// 1. Export to PDF (via canvas capturing)
export async function downloadPDF(elementId, fileName = "resume.pdf") {
  const element = document.getElementById(elementId);
  if (!element) {
    console.error("Target preview element not found.");
    return;
  }

  // Ensure all fonts being used in the resume are fully downloaded and loaded before rendering
  if (document.fonts) {
    try {
      // Collect all font families used in the element and its descendants
      const fontsToLoad = new Set(["Inter"]);
      if (element.style.fontFamily) {
        const primaryFont = element.style.fontFamily.split(",")[0].trim().replace(/['"]/g, "");
        if (primaryFont) fontsToLoad.add(primaryFont);
      }
      element.querySelectorAll("*").forEach(el => {
        const compStyle = window.getComputedStyle(el);
        const font = compStyle.fontFamily;
        if (font) {
          const mainFont = font.split(",")[0].trim().replace(/['"]/g, "");
          if (mainFont) fontsToLoad.add(mainFont);
        }
      });

      // Load regular and bold weights for each custom font family detected
      for (const font of fontsToLoad) {
        await document.fonts.load(`12px "${font}"`);
        await document.fonts.load(`bold 12px "${font}"`);
      }
      await document.fonts.ready;
    } catch (e) {
      console.warn("Preloading fonts failed, proceeding with fallback fonts:", e);
    }
  }

  // Create an isolated clone of the resume element
  const clone = element.cloneNode(true);
  
  // Set clone styles to guarantee perfect layout containment and standard width without screen flashing
  clone.style.position = "absolute";
  clone.style.left = "-9999px";
  clone.style.top = "0";
  clone.style.width = "794px"; // Standard A4 width in pixels
  clone.style.minHeight = "1123px";
  clone.style.height = "auto";
  clone.style.boxShadow = "none";
  clone.style.transform = "none";
  clone.style.transition = "none";
  clone.style.margin = "0";
  clone.style.padding = element.style.padding || "20px";
  clone.style.background = "#ffffff";

  // Safely copy inline style properties
  clone.style.fontFamily = element.style.fontFamily;
  clone.style.fontSize = element.style.fontSize;
  clone.style.lineHeight = element.style.lineHeight;
  
  // Force clean white background and dark text on the clone to prevent dark mode leakage!
  clone.style.setProperty("background-color", "#ffffff", "important");
  clone.style.setProperty("background", "#ffffff", "important");
  clone.style.setProperty("color", "#1e293b", "important");
  clone.style.backgroundColor = "#ffffff";
  clone.style.color = "#1e293b";

  // Copy all CSS custom properties (variables)
  clone.style.setProperty("--primary-color", element.style.getPropertyValue("--primary-color") || "#0f172a");
  clone.style.setProperty("--secondary-color", element.style.getPropertyValue("--secondary-color") || "#475569");

  // Post-process the cloned elements to ensure 100% accurate layout & typography matching the preview
  const allClonedDescendants = clone.querySelectorAll("*");
  allClonedDescendants.forEach(el => {
    // 1. Clean class strings safely (even for SVGs and non-string classNames)
    let classNameStr = "";
    if (el.className && typeof el.className === "string") {
      classNameStr = el.className;
    } else if (el.getAttribute) {
      classNameStr = el.getAttribute("class") || "";
    }

    // Clean tracking classes from ALL elements (headings and non-headings alike)
    if (classNameStr) {
      const cleanedClass = classNameStr
        .replace(/\btracking-tight\S*/gi, "")
        .replace(/\btracking-tighter\S*/gi, "")
        .replace(/\btracking-[-0-9.]+\S*/gi, ""); // strip custom negative tracking
      
      if (typeof el.className === "string") {
        el.className = cleanedClass;
      } else if (el.setAttribute) {
        el.setAttribute("class", cleanedClass);
      }
    }

    // 2. Force absolutely normal, zero letter-spacing to prevent html2canvas character-splat overlapping bug
    el.style.setProperty("letter-spacing", "0px", "important");
    el.style.letterSpacing = "0px";
    el.style.setProperty("word-spacing", "normal", "important");
    el.style.wordSpacing = "normal";

    // 3. Identify if element is a heading or section header
    const isHeading = el.tagName.match(/^H[1-6]$/i) || classNameStr.includes("section-header") || el.tagName === "H2" || el.tagName === "H3" || el.tagName === "H4";

    // 4. Force clean visible dark text colors on body text descendants to prevent inheriting white text from dark mode builder workspace
    if (!isHeading && el.tagName !== "SVG" && !el.closest("svg")) {
      el.style.setProperty("color", "#334155", "important");
    }

    // 5. Disable font-variant-ligatures and force font family match
    el.style.fontVariantLigatures = "none";
    el.style.setProperty("font-variant-ligatures", "none", "important");
  });

  // Append clone to document.body (standard container insertion) so it inherits style contexts and is placed off-screen
  document.body.appendChild(clone);

  const { jsPDF } = window.jspdf;

  try {
    // Add a small delay to let browser complete reflow/layout rendering for the cloned element
    await new Promise(resolve => setTimeout(resolve, 500));
    
    if (document.fonts) {
      try {
        await document.fonts.ready;
      } catch (e) {
        console.warn("Fonts ready check on clone failed:", e);
      }
    }

    const canvas = await html2canvas(clone, {
      scale: 2.5, // High resolution capture
      useCORS: true,
      allowTaint: false, // Must be false for CORS fonts to render properly
      logging: false,
      backgroundColor: "#ffffff",
      windowWidth: 794,
      windowHeight: clone.offsetHeight || 1123
    });

    const imgData = canvas.toDataURL("image/jpeg", 0.95);
    
    // Create A4 PDF (210mm x 297mm)
    const pdf = new jsPDF("p", "mm", "a4");
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    
    const imgWidth = pdfWidth;
    const imgHeight = (canvas.height * pdfWidth) / canvas.width;
    
    let heightLeft = imgHeight;
    let position = 0;

    // Add first page
    pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
    heightLeft -= pdfHeight;

    // Support multi-page flows perfectly without broken sections
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;
    }

    pdf.save(fileName);
  } catch (error) {
    console.error("PDF generation failed:", error);
    alert("An error occurred during PDF generation. Please try standard print (Ctrl+P) as a secondary high-quality option.");
  } finally {
    // Clean up: remove the cloned element from the DOM
    if (clone && clone.parentNode) {
      clone.parentNode.removeChild(clone);
    }
  }
}

// 2. Export to Word (DOCX using docx.js)
export async function downloadWord(resumeData, fileName = "resume.docx") {
  try {
    const docxObj = window.docx;
    if (!docxObj) {
      alert("Word export engine is still loading. Please try again in a few seconds.");
      return;
    }

    const {
      Document,
      Packer,
      Paragraph,
      TextRun,
      HeadingLevel,
      AlignmentType,
      BorderStyle,
      Table,
      TableRow,
      TableCell,
      WidthType
    } = docxObj;

    const p = resumeData.personalInfo || {};
    const theme = resumeData.themeSettings || {};
    const templateId = resumeData.templateId || "modern_ats";
    const fontFamily = theme.fontFamily || "Arial";
    
    // Strip hashtag and convert to uppercase hex for DOCX colors
    const primaryHex = (theme.primaryColor || "0F172A").replace("#", "").toUpperCase();
    const secondaryHex = (theme.secondaryColor || "475569").replace("#", "").toUpperCase();
    const textHex = "1E293B"; // Dark slate body text
    const grayHex = "64748B"; // Slate gray details

    // Determine layout columns matching builder.js
    const isSidebarLayout = templateId === "creative" || templateId === "sidebar_resume" || templateId === "designer_resume" || templateId === "colorful_resume";
    const isTwoColumnRight = templateId === "executive" || templateId === "developer_resume" || templateId === "data_analyst_resume" || templateId === "luxury";

    // Helper to create paragraphs with exact fonts and styling
    const createTextParagraph = (text, options = {}) => {
      const runs = [];
      if (typeof text === "string") {
        runs.push(new TextRun({
          text: text,
          font: fontFamily,
          size: options.size || 20, // default 10pt
          bold: options.bold || false,
          italic: options.italic || false,
          color: options.color || textHex
        }));
      } else if (Array.isArray(text)) {
        text.forEach(run => {
          runs.push(new TextRun({
            text: run.text || "",
            font: fontFamily,
            size: run.size || options.size || 20,
            bold: run.bold || false,
            italic: run.italic || false,
            color: run.color || options.color || textHex
          }));
        });
      }
      return new Paragraph({
        children: runs,
        alignment: options.alignment || AlignmentType?.LEFT || "left",
        spacing: {
          before: options.spaceBefore || 0,
          after: options.spaceAfter || 120, // default 6pt after
        }
      });
    };

    // Helper for adding section headers with bottom borders matching the design
    const createSectionHeader = (title) => {
      return new Paragraph({
        children: [
          new TextRun({
            text: title.toUpperCase(),
            font: fontFamily,
            size: 24, // 12pt
            bold: true,
            color: primaryHex,
          })
        ],
        border: {
          bottom: {
            color: primaryHex,
            space: 4,
            style: BorderStyle?.SINGLE || "single",
            size: 12, // 1.5 pt thickness
          },
        },
        spacing: {
          before: 240, // space before section
          after: 120,  // space after
        }
      });
    };

    // Helper to format multiline description fields into neat indents with custom bullet points in DOCX
    const createDescriptionParagraphs = (text) => {
      if (!text) return [];
      const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
      if (lines.length === 0) return [];
      
      // If only one line and doesn't start with any bullet characters, render as standard paragraph
      if (lines.length === 1 && !/^[-\*•·○■]/.test(lines[0])) {
        return [
          createTextParagraph(lines[0], {
            size: 20,
            spaceAfter: 120
          })
        ];
      }
      
      return lines.map(line => {
        // Strip common bullet characters if present
        const cleaned = line.replace(/^[\s\-*•·○■]+/, "").trim();
        return new Paragraph({
          children: [
            new TextRun({
              text: "•   " + cleaned,
              font: fontFamily,
              size: 20,
              color: textHex
            })
          ],
          spacing: {
            before: 40,
            after: 40
          },
          indent: {
            left: 240, // Elegant indent matching document layout margins
          }
        });
      });
    };

    // Pre-compile all sections separately
    const sections = {
      header: [],
      contacts: [],
      summary: [],
      experience: [],
      education: [],
      projects: [],
      skills: [],
      certifications: [],
      achievements: [],
      custom: []
    };

    // 1. Header (Name & Title)
    sections.header.push(
      createTextParagraph(p.fullName || "Your Name", {
        size: 36, // 18pt
        bold: true,
        color: primaryHex,
        spaceAfter: 40
      })
    );
    sections.header.push(
      createTextParagraph(p.jobTitle || "Your Professional Title", {
        size: 24, // 12pt
        bold: true,
        italic: true,
        color: secondaryHex,
        spaceAfter: 120
      })
    );

    // 2. Summary
    if (resumeData.summary) {
      sections.summary.push(createSectionHeader(isSidebarLayout ? "Profile Summary" : "Professional Summary"));
      sections.summary.push(
        createTextParagraph(resumeData.summary, {
          size: 20,
          spaceAfter: 120
        })
      );
    }

    // 3. Work Experience
    if (resumeData.experience && resumeData.experience.length > 0) {
      sections.experience.push(createSectionHeader(isSidebarLayout ? "Professional Experience" : (isTwoColumnRight ? "Work Experience" : "Work Experience")));
      resumeData.experience.forEach(exp => {
        sections.experience.push(
          new Paragraph({
            children: [
              new TextRun({ text: exp.role || "Role", font: fontFamily, size: 22, bold: true, color: textHex }),
              new TextRun({ text: `   |   ${exp.company || "Company"} (${exp.location || ""})`, font: fontFamily, size: 20, italic: true, color: secondaryHex })
            ],
            spacing: { before: 80, after: 40 }
          })
        );
        sections.experience.push(
          createTextParagraph(`${exp.startDate || ""} - ${exp.current ? "Present" : (exp.endDate || "")}`, {
            size: 18,
            color: grayHex,
            italic: true,
            spaceAfter: 40
          })
        );
        if (exp.description) {
          sections.experience.push(...createDescriptionParagraphs(exp.description));
        }
      });
    }

    // 4. Education
    if (resumeData.education && resumeData.education.length > 0) {
      sections.education.push(createSectionHeader("Education"));
      resumeData.education.forEach(edu => {
        sections.education.push(
          new Paragraph({
            children: [
              new TextRun({ text: edu.degree || "Degree", font: fontFamily, size: 22, bold: true, color: textHex }),
              new TextRun({ text: `   |   ${edu.institution || "Institution"} (${edu.location || ""})`, font: fontFamily, size: 20, italic: true, color: secondaryHex })
            ],
            spacing: { before: 80, after: 40 }
          })
        );
        sections.education.push(
          createTextParagraph(`${edu.startDate || ""} - ${edu.endDate || ""}`, {
            size: 18,
            color: grayHex,
            italic: true,
            spaceAfter: 120
          })
        );
      });
    }

    // 5. Projects
    if (resumeData.projects && resumeData.projects.length > 0) {
      sections.projects.push(createSectionHeader("Projects"));
      resumeData.projects.forEach(proj => {
        sections.projects.push(
          new Paragraph({
            children: [
              new TextRun({ text: proj.title || "Project Title", font: fontFamily, size: 22, bold: true, color: textHex }),
              proj.link ? new TextRun({ text: `   (Link: ${proj.link})`, font: fontFamily, size: 18, color: secondaryHex, italic: true }) : new TextRun({ text: "" })
            ],
            spacing: { before: 80, after: 40 }
          })
        );
        if (proj.skills) {
          sections.projects.push(
            createTextParagraph([
              { text: "Technologies / Skills used: ", bold: true, color: primaryHex, size: 18 },
              { text: proj.skills, italic: true, color: textHex, size: 18 }
            ], { spaceAfter: 40 })
          );
        }
        if (proj.description) {
          sections.projects.push(...createDescriptionParagraphs(proj.description));
        }
      });
    }

    // 6. Skills compiling (flexible for both new dynamic arrays or legacy object)
    let skillSectionsList = [];
    if (Array.isArray(resumeData.skills)) {
      skillSectionsList = resumeData.skills;
    } else if (resumeData.skills && typeof resumeData.skills === "object") {
      skillSectionsList = [
        { title: "Technical Skills", skills: resumeData.skills.technical || [] },
        { title: "Soft Skills", skills: resumeData.skills.soft || [] },
        { title: "Languages", skills: resumeData.skills.languages || [] }
      ];
    }
    const hasAnySkills = skillSectionsList.some(cat => cat.skills && cat.skills.length > 0);
    if (hasAnySkills) {
      sections.skills.push(createSectionHeader("Skills"));
      skillSectionsList.forEach((sec, idx) => {
        if (sec.skills && sec.skills.length > 0) {
          sections.skills.push(
            createTextParagraph([
              { text: `${sec.title}: `, bold: true, color: primaryHex, size: 20 },
              { text: sec.skills.join(", "), color: textHex, size: 20 }
            ], { spaceAfter: (idx === skillSectionsList.length - 1) ? 120 : 80 })
          );
        }
      });
    }

    // 6.1. Certifications
    if (resumeData.certifications && resumeData.certifications.length > 0) {
      sections.certifications.push(createSectionHeader("Certifications"));
      resumeData.certifications.filter(Boolean).forEach(cert => {
        sections.certifications.push(
          new Paragraph({
            children: [
              new TextRun({ text: "•   " + cert, font: fontFamily, size: 20, color: textHex })
            ],
            spacing: { before: 40, after: 40 },
            indent: { left: 240 }
          })
        );
      });
    }

    // 6.2. Awards & Achievements
    if (resumeData.achievements && resumeData.achievements.length > 0) {
      sections.achievements.push(createSectionHeader("Awards & Achievements"));
      resumeData.achievements.filter(Boolean).forEach(ach => {
        sections.achievements.push(
          new Paragraph({
            children: [
              new TextRun({ text: "•   " + ach, font: fontFamily, size: 20, color: textHex })
            ],
            spacing: { before: 40, after: 40 },
            indent: { left: 240 }
          })
        );
      });
    }

    // 7. Custom Sections
    if (resumeData.customSections && resumeData.customSections.length > 0) {
      resumeData.customSections.forEach(cs => {
        sections.custom.push(createSectionHeader(cs.title));
        if (cs.description) {
          sections.custom.push(
            createTextParagraph(cs.description, {
              size: 20,
              spaceAfter: 120
            })
          );
        }
      });
    }

    const finalChildren = [];
    const order = resumeData.sectionOrder || ["summary", "experience", "education", "projects", "skills", "certifications", "achievements", "custom"];

    if (isSidebarLayout) {
      // 2-Column Left Sidebar layout mapping
      const sidebarChildren = [];
      sidebarChildren.push(...sections.header);
      
      // Vertical Contacts
      const contacts = [
        { label: "Email: ", val: p.email },
        { label: "Phone: ", val: p.phone },
        { label: "Address: ", val: p.address },
        { label: "LinkedIn: ", val: p.linkedin },
        { label: "GitHub: ", val: p.github },
        { label: "Portfolio: ", val: p.portfolio }
      ].filter(c => c.val);
      
      contacts.forEach(c => {
        sidebarChildren.push(
          createTextParagraph([
            { text: c.label, bold: true, color: primaryHex, size: 18 },
            { text: c.val, color: textHex, size: 18 }
          ], { spaceAfter: 60 })
        );
      });

      // Render dynamic skill subheadings in sidebar
      skillSectionsList.forEach(sec => {
        if (sec.skills && sec.skills.length > 0) {
          sidebarChildren.push(createSectionHeader(sec.title));
          sidebarChildren.push(createTextParagraph(sec.skills.join(", "), { size: 18, spaceAfter: 120 }));
        }
      });

      // Main Content Column
      const mainChildren = [];
      order.forEach(key => {
        if (["summary", "experience", "education", "projects", "certifications", "achievements", "custom"].includes(key)) {
          mainChildren.push(...sections[key]);
        }
      });

      const columnsTable = new Table({
        width: { size: 100, type: WidthType?.PERCENTAGE || "pct" },
        borders: {
          top: { style: BorderStyle?.NONE || "none", size: 0, color: "auto" },
          bottom: { style: BorderStyle?.NONE || "none", size: 0, color: "auto" },
          left: { style: BorderStyle?.NONE || "none", size: 0, color: "auto" },
          right: { style: BorderStyle?.NONE || "none", size: 0, color: "auto" },
          insideHorizontal: { style: BorderStyle?.NONE || "none", size: 0, color: "auto" },
          insideVertical: { style: BorderStyle?.NONE || "none", size: 0, color: "auto" },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 32, type: WidthType?.PERCENTAGE || "pct" },
                margins: { top: 150, bottom: 150, left: 150, right: 150 },
                children: sidebarChildren.length > 0 ? sidebarChildren : [new Paragraph({ text: "" })],
              }),
              new TableCell({
                width: { size: 68, type: WidthType?.PERCENTAGE || "pct" },
                margins: { top: 150, bottom: 150, left: 150, right: 150 },
                children: mainChildren.length > 0 ? mainChildren : [new Paragraph({ text: "" })],
              }),
            ],
          }),
        ],
      });

      finalChildren.push(columnsTable);

    } else if (isTwoColumnRight) {
      // 2-Column Right Sidebar layout mapping
      finalChildren.push(...sections.header);
      
      const contactsArr = [p.email, p.phone, p.address, p.linkedin, p.github, p.portfolio].filter(Boolean);
      finalChildren.push(
        createTextParagraph(contactsArr.join("   |   "), {
          size: 18,
          color: grayHex,
          spaceAfter: 200,
          alignment: AlignmentType?.CENTER || "center"
        })
      );

      // Left wide column
      const leftChildren = [];
      order.forEach(key => {
        if (["summary", "experience", "projects", "certifications", "achievements", "custom"].includes(key)) {
          leftChildren.push(...sections[key]);
        }
      });

      // Right narrow column
      const rightChildren = [];
      rightChildren.push(...sections.education);
      
      // Render dynamic skill subheadings in right column
      skillSectionsList.forEach(sec => {
        if (sec.skills && sec.skills.length > 0) {
          rightChildren.push(createSectionHeader(sec.title));
          rightChildren.push(createTextParagraph(sec.skills.join(", "), { size: 18, spaceAfter: 120 }));
        }
      });

      const columnsTable = new Table({
        width: { size: 100, type: WidthType?.PERCENTAGE || "pct" },
        borders: {
          top: { style: BorderStyle?.NONE || "none", size: 0, color: "auto" },
          bottom: { style: BorderStyle?.NONE || "none", size: 0, color: "auto" },
          left: { style: BorderStyle?.NONE || "none", size: 0, color: "auto" },
          right: { style: BorderStyle?.NONE || "none", size: 0, color: "auto" },
          insideHorizontal: { style: BorderStyle?.NONE || "none", size: 0, color: "auto" },
          insideVertical: { style: BorderStyle?.NONE || "none", size: 0, color: "auto" },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 65, type: WidthType?.PERCENTAGE || "pct" },
                margins: { top: 150, bottom: 150, left: 150, right: 150 },
                children: leftChildren.length > 0 ? leftChildren : [new Paragraph({ text: "" })],
              }),
              new TableCell({
                width: { size: 35, type: WidthType?.PERCENTAGE || "pct" },
                margins: { top: 150, bottom: 150, left: 150, right: 150 },
                children: rightChildren.length > 0 ? rightChildren : [new Paragraph({ text: "" })],
              }),
            ],
          }),
        ],
      });

      finalChildren.push(columnsTable);

    } else {
      // Standard One Column layout
      finalChildren.push(...sections.header);
      
      const contactsArr = [p.email, p.phone, p.address, p.linkedin, p.github, p.portfolio].filter(Boolean);
      const align = theme.headerAlign === "center" ? (AlignmentType?.CENTER || "center") : (theme.headerAlign === "right" ? (AlignmentType?.RIGHT || "right") : (AlignmentType?.LEFT || "left"));
      
      finalChildren.push(
        createTextParagraph(contactsArr.join("   |   "), {
          size: 18,
          color: grayHex,
          spaceAfter: 200,
          alignment: align
        })
      );

      order.forEach(key => {
        finalChildren.push(...sections[key]);
      });
    }

    // Create Word document with final children
    const doc = new Document({
      sections: [{
        properties: {},
        children: finalChildren,
      }],
    });

    // Generate blob & download
    const blob = await Packer.toBlob(doc);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (err) {
    console.error("DOCX generation failed:", err);
    alert("Could not generate Word document. Please verify network access.");
  }
}

// 3. Export JSON backup
export function downloadJSON(resumeData, fileName = "resume_backup.json") {
  const jsonString = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(resumeData, null, 2));
  const dlAnchorElem = document.createElement("a");
  dlAnchorElem.setAttribute("href", jsonString);
  dlAnchorElem.setAttribute("download", fileName);
  dlAnchorElem.click();
}
