# Uniform Detection Best Practice: Code-Level Gender Merging

## The Problem
Course uniforms have male and female variants. In the past, we thought about merging them into one giant class in Roboflow to avoid gender-confusion bugs. However, merging them makes labeling annoying, and it strips away valuable data the AI could use to identify distinct male vs. female collar shapes.

## The Best Solution: Code-Level Merging
Instead of doing tricks in Roboflow to merge classes, we keep them separated in the AI, and let the system's code handle the logic.

### How to do it:
1. **In Roboflow (Training):** Label everything naturally. Create `coag_female_uniform` and label all the female photos. Create `coag_male_uniform` and label all the male photos. No "Modify Classes" trick needed.
2. **The Result:** The AI learns the distinct features of the female uniform AND the distinct features of the male uniform, making it incredibly smart and accurate.
3. **In the Code/Database:** We simply tell the system that BOTH variants belong to the same course. 
   ```javascript
   // System Logic Example
   if (detected == 'coag_female_uniform' || detected == 'coag_male_uniform') {
       valid_course = 'COAGRI';
   }
   ```

### Why this is the best approach:
- **Easier Labeling:** You don't have to remember to do special merging tricks in Roboflow before you hit download. Just label things exactly what they are.
- **Smarter AI:** The AI gets to learn the nuanced differences between male and female collars, making its bounding boxes tighter and more accurate.
- **Zero "Wrong Gender" Bugs:** Even if the AI accidentally thinks a male student is wearing the female version, the gate will STILL open because the code maps BOTH of them to the same valid course. The student passes without issues!
